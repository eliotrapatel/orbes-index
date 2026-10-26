/**
 * The engagement score's daily job (plan CUSTOMER INTELLIGENCE §3.5 SB.3.3, SB.3.5, SB.3.7, §3.0 (f), step 7.4;
 * services/engagement.ts `runIfDue`, context.ts `startHousekeeping`), on PGlite with a manual clock:
 *
 *  - not due before 07:30 UTC, under summer time (CEST) and winter time (CET); due until the Paris day ends, and not
 *    in the first hours of the next Paris day; once per Paris day;
 *  - postponed while a LIVE RELEASE's room is open (from `room_opens_minutes` before T0 until its end; a draft and a
 *    cancelled release never hold it), and while a test of test entrants is RUNNING;
 *  - two passes at once give one run; an unfinished claim is taken over after 20 minutes, not before; a failed batch
 *    fails the whole run, which is claimed again once stale;
 *  - the batches of 500 in `id` order with a pause between two of them;
 *  - the housekeeping pass runs it after that pass's `viewStats` and before the purges, returns `engagement` (the rows
 *    changed, 0 when not due), logs one line, and logs a failure without throwing.
 * What a run writes (the clean-up, the bands, a formula's change) is test/services/engagement.test.ts.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHousekeeping } from '../../src/server/context.js';
import { jsonText, VIEW_PAGE_CODES } from '../../src/server/db/schema.js';
import { ENGAGEMENT_BATCH, ENGAGEMENT_PAUSE_MS, ENGAGEMENT_STALE_MINUTES, EngagementService } from '../../src/server/services/engagement.js';
import { ENGAGEMENT_FORMULA } from '../../src/server/services/engagement-formula.js';
import type { Logger } from '../../src/server/types.js';
import { createHarness, type Harness } from '../api/support.js';
import { GrowthWorld } from '../support/growth.js';

interface Line {
  level: 'info' | 'warn' | 'error';
  o: unknown;
  msg?: string;
}

describe('the engagement score\'s daily job (plan CUSTOMER INTELLIGENCE §3.5 SB.3.3)', () => {
  let h: Harness;
  let w: GrowthWorld;
  let svc: EngagementService;
  let model: string;
  let admin: string;
  const lines: Line[] = [];
  const db = () => h.t.db;
  const runs = () => db().selectFrom('engagement_runs').selectAll().orderBy('day').execute();
  const scored = async () => Number((await db().selectFrom('account_scores').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow()).n);
  /** The accounts a run scores now: ACTIVE, not test entrants. */
  const population = async () =>
    Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM accounts a WHERE a.status = 'ACTIVE' AND NOT EXISTS (SELECT 1 FROM test_entrants te WHERE te.account_id = a.id)`.execute(db())).rows[0]!.n);
  const liveRelease = async (opens: string, o: { published?: boolean; cancelled?: boolean } = {}) => w.drop({ mode: 'LIVE', modelId: model, title: `LIVE ${opens}`, opens, quantity: 5, ...o });
  const end = (dropId: string, at: string) => db().updateTable('drops').set({ ended_at: new Date(at), ended_reason: 'CLOSED' }).where('id', '=', dropId).execute();

  beforeAll(async () => {
    const log: Logger = {
      info: (o, msg) => lines.push({ level: 'info', o, msg }),
      warn: (o, msg) => lines.push({ level: 'warn', o, msg }),
      error: (o, msg) => lines.push({ level: 'error', o, msg }),
    };
    h = await createHarness({ context: { log } });
    h.clock.set('2026-10-19T12:00:00.000Z');
    svc = h.ctx.services.engagement;
    w = await new GrowthWorld(db()).prepare();
    model = await w.model('MONOLITHE', { price: [30_000, 'EUR'] });
    admin = (await db().insertInto('admin_users').values({ email: 'tests@orbes.test', email_normalized: 'tests@orbes.test', password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow()).id;
    for (let n = 0; n < 6; n++) await w.account('2025-03-01', 'FR');
    const entrant = await w.account('2025-03-01', 'FR');
    await db().insertInto('test_entrants').values({ account_id: entrant }).execute();
    await w.account('2025-03-01', 'FR', 'LOCKED');
    await w.account('2025-03-01', 'FR', 'DELETED');
    // The recording started on 15 November with the past scans recorded, so the pass of the 16th counts the views' first day.
    await db().updateTable('tracking_state').set({ started_at: new Date('2026-11-15T07:00:00Z'), scans_backfilled_at: new Date('2026-11-15T07:00:00Z') }).where('id', '=', 1).execute();
  });
  afterAll(() => h?.close());

  it('is not due before 07:30 UTC, in summer time and in winter time; runs once per Paris day, until that day ends', async () => {
    // 20 October 2026, summer time (07:30 UTC is 09:30 Paris).
    expect(await svc.runIfDue(new Date('2026-10-20T07:29:59.999Z'))).toBeNull();
    expect(await runs()).toEqual([]);
    expect(await scored()).toBe(0);
    const first = await svc.runIfDue(new Date('2026-10-20T07:30:00.000Z'));
    expect(first).toMatchObject({ day: '2026-10-20', accounts: 6, changed: 6 });
    expect(first!.accounts).toBe(await population());
    expect(first!.bands).toEqual([6, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(await scored()).toBe(6);
    expect(await runs()).toEqual([
      { day: '2026-10-20', formula: ENGAGEMENT_FORMULA, started_at: new Date('2026-10-20T07:30:00.000Z'), finished_at: expect.any(Date), accounts: 6, changed: 6, bands: [6, 0, 0, 0, 0, 0, 0, 0, 0, 0], duration_ms: first!.ms },
    ]);
    // A second pass the same day does nothing, whatever the hour.
    for (const later of ['2026-10-20T07:40:00.000Z', '2026-10-20T15:00:00.000Z', '2026-10-20T21:59:59.000Z']) expect(await svc.runIfDue(new Date(later)), later).toBeNull();
    expect(await runs()).toHaveLength(1);
    // 22:30 UTC is 00:30 Paris on the 21st: a new Paris day, before its window.
    expect(await svc.runIfDue(new Date('2026-10-20T22:30:00.000Z'))).toBeNull();
    // A day when nothing cleared earlier still runs at 23:50 Paris: the window lasts until the Paris day ends.
    expect(await svc.runIfDue(new Date('2026-10-21T21:50:00.000Z'))).toMatchObject({ day: '2026-10-21', accounts: 6, changed: 0 });
    // 3 November 2026, winter time (07:30 UTC is 08:30 Paris).
    expect(await svc.runIfDue(new Date('2026-11-03T07:29:59.999Z'))).toBeNull();
    expect(await svc.runIfDue(new Date('2026-11-03T07:30:00.000Z'))).toMatchObject({ day: '2026-11-03', accounts: 6, changed: 0 });
    // 22:30 UTC is 23:30 Paris the same day in winter time: still that day, already run.
    expect(await svc.runIfDue(new Date('2026-11-03T22:30:00.000Z'))).toBeNull();
    // 23:30 UTC is 00:30 Paris on the 4th: before its window.
    expect(await svc.runIfDue(new Date('2026-11-03T23:30:00.000Z'))).toBeNull();
    expect((await runs()).map((r) => r.day)).toEqual(['2026-10-20', '2026-10-21', '2026-11-03']);
    // Called without an instant, it reads the clock.
    h.clock.set('2026-11-04T08:00:00.000Z');
    expect(await svc.runIfDue()).toMatchObject({ day: '2026-11-04' });
  });

  it('waits while a LIVE RELEASE\'s room is open, from its opening to the release\'s end; a draft and a cancelled release never hold it', async () => {
    // A draft and a cancelled LIVE RELEASE whose T0 is long past: neither has a room.
    await liveRelease('2026-11-01', { published: false });
    await liveRelease('2026-11-02', { cancelled: true });
    // T0 at 12:00 UTC on 5 November, the room 5 minutes before it.
    const release = await liveRelease('2026-11-05');
    expect(await svc.runIfDue(new Date('2026-11-05T11:54:59.999Z'))).toMatchObject({ day: '2026-11-05' });
    // The next day's release: the pass at the room's opening waits, and so does every pass until the release ends.
    await end(release.id, '2026-11-05T13:00:00Z');
    const next = await liveRelease('2026-11-06');
    for (const at of ['2026-11-06T11:55:00.000Z', '2026-11-06T12:00:00.000Z', '2026-11-06T16:00:00.000Z']) expect(await svc.runIfDue(new Date(at)), at).toBeNull();
    expect((await runs()).some((r) => r.day === '2026-11-06')).toBe(false);
    await end(next.id, '2026-11-06T16:05:00Z');
    expect(await svc.runIfDue(new Date('2026-11-06T16:10:00.000Z'))).toMatchObject({ day: '2026-11-06' });
    // A release never ended holds every later day: the day has no run, and the next one runs once it has ended.
    const open = await liveRelease('2026-11-07');
    for (const at of ['2026-11-07T12:00:00.000Z', '2026-11-07T22:50:00.000Z']) expect(await svc.runIfDue(new Date(at)), at).toBeNull();
    await end(open.id, '2026-11-07T23:30:00Z');
    expect(await svc.runIfDue(new Date('2026-11-08T07:30:00.000Z'))).toMatchObject({ day: '2026-11-08' });
    expect((await runs()).map((r) => r.day).filter((day) => day >= '2026-11-05')).toEqual(['2026-11-05', '2026-11-06', '2026-11-08']);
  });

  it('waits while a test of test entrants is RUNNING', async () => {
    const drop = await w.drop({ mode: 'DRAW', modelId: model, title: 'TESTED', opens: '2026-12-01', quantity: 5 });
    const run = await db().insertInto('test_runs').values({ drop_id: drop.id, mode: 'DRAW', status: 'RUNNING', settings: jsonText([]), entrants: 100, created_by: admin, created_at: new Date('2026-11-09T07:00:00Z') }).returning('id').executeTakeFirstOrThrow();
    expect(await svc.runIfDue(new Date('2026-11-09T08:00:00.000Z'))).toBeNull();
    expect(await svc.runIfDue(new Date('2026-11-09T09:00:00.000Z'))).toBeNull();
    // Every bot has acted: the test no longer runs, the next pass scores.
    await db().updateTable('test_runs').set({ status: 'DONE' }).where('id', '=', run.id).execute();
    expect(await svc.runIfDue(new Date('2026-11-09T09:10:00.000Z'))).toMatchObject({ day: '2026-11-09' });
  });

  it('gives one run when two passes come at once', async () => {
    const at = new Date('2026-11-10T07:30:00.000Z');
    const both = await Promise.all([svc.runIfDue(at), svc.runIfDue(at), svc.runIfDue(new Date(at.getTime() + 1))]);
    expect(both.filter((r) => r !== null)).toHaveLength(1);
    const day = (await runs()).filter((r) => r.day === '2026-11-10');
    expect(day).toHaveLength(1);
    expect(day[0]).toMatchObject({ accounts: 6, changed: 0 });
    expect(day[0]!.finished_at).not.toBeNull();
  });

  it('takes over an unfinished claim after 20 minutes, not before', async () => {
    expect(ENGAGEMENT_STALE_MINUTES).toBe(20);
    const started = new Date('2026-11-11T07:30:00.000Z');
    await db().insertInto('engagement_runs').values({ day: '2026-11-11', formula: ENGAGEMENT_FORMULA, started_at: started }).execute();
    const row = async () => (await runs()).find((r) => r.day === '2026-11-11')!;
    // The passes 10 and 20 minutes later leave it to the process that claimed it.
    expect(await svc.runIfDue(new Date('2026-11-11T07:40:00.000Z'))).toBeNull();
    expect(await svc.runIfDue(new Date('2026-11-11T07:50:00.000Z'))).toBeNull();
    expect(await row()).toMatchObject({ started_at: started, finished_at: null, accounts: null, bands: null });
    // A millisecond past the 20 minutes: taken over, from the start.
    const taken = new Date('2026-11-11T07:50:00.001Z');
    expect(await svc.runIfDue(taken)).toMatchObject({ day: '2026-11-11', accounts: 6 });
    expect(await row()).toMatchObject({ started_at: taken, accounts: 6, changed: 0 });
    expect((await row()).finished_at).not.toBeNull();
    // A claim left by an older formula takes this one's number.
    await db().insertInto('engagement_runs').values({ day: '2026-11-12', formula: ENGAGEMENT_FORMULA + 3, started_at: new Date('2026-11-12T07:30:00.000Z') }).execute();
    expect(await svc.runIfDue(new Date('2026-11-12T08:00:00.000Z'))).toMatchObject({ day: '2026-11-12' });
    expect((await runs()).find((r) => r.day === '2026-11-12')!.formula).toBe(ENGAGEMENT_FORMULA);
  });

  it('fails the whole run when a batch fails, and claims the day again once the claim is stale', async () => {
    const pauses: number[] = [];
    let fail = true;
    const flaky = new (class extends EngagementService {
      override async scoreBatch(...args: Parameters<EngagementService['scoreBatch']>) {
        if (fail) throw new Error('the batch failed');
        return super.scoreBatch(...args);
      }
    })({ db: db(), clock: h.clock.now, sleep: async (ms) => void pauses.push(ms) });
    await expect(flaky.runIfDue(new Date('2026-11-13T07:30:00.000Z'))).rejects.toThrow('the batch failed');
    const row = async () => (await runs()).find((r) => r.day === '2026-11-13')!;
    expect(await row()).toMatchObject({ finished_at: null, accounts: null, changed: null, bands: null, duration_ms: null });
    fail = false;
    // The next pass, 10 minutes later, does not hold the day yet; the one after the 20 minutes runs it.
    expect(await flaky.runIfDue(new Date('2026-11-13T07:40:00.000Z'))).toBeNull();
    expect(await flaky.runIfDue(new Date('2026-11-13T08:00:00.000Z'))).toMatchObject({ day: '2026-11-13', accounts: 6 });
    expect((await row()).finished_at).not.toBeNull();
    // Six accounts are one batch: no pause.
    expect(pauses).toEqual([]);
  });

  it('scores in batches of 500 in id order, with a pause between two batches', async () => {
    expect(ENGAGEMENT_BATCH).toBe(500);
    expect(ENGAGEMENT_PAUSE_MS).toBe(100);
    const before = await population();
    // 1 100 more accounts, written in bulk: three batches in all.
    await sql`
      INSERT INTO accounts (email, email_normalized, password_hash, created_at)
      SELECT 'bulk-' || g || '@example.com', 'bulk-' || g || '@example.com', 'unused', '2026-11-01T10:00:00Z'::timestamptz FROM generate_series(1, 1100) g`.execute(db());
    const pauses: number[] = [];
    const batches: string[][] = [];
    const counting = new (class extends EngagementService {
      override async scoreBatch(...args: Parameters<EngagementService['scoreBatch']>) {
        batches.push([...args[0]]);
        return super.scoreBatch(...args);
      }
    })({ db: db(), clock: h.clock.now, sleep: async (ms) => void pauses.push(ms) });
    const run = await counting.runIfDue(new Date('2026-11-14T07:30:00.000Z'));
    expect(run).toMatchObject({ day: '2026-11-14', accounts: before + 1100, changed: 1100 });
    expect(batches.map((b) => b.length)).toEqual([500, 500, before + 100]);
    const all = batches.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual([...all].sort());
    expect(pauses).toEqual([ENGAGEMENT_PAUSE_MS, ENGAGEMENT_PAUSE_MS]);
    expect(run!.bands.reduce((a, b) => a + b, 0)).toBe(before + 1100);
    expect(await scored()).toBe(before + 1100);
    // The bulk accounts leave again, so the later cases keep their six.
    await sql`DELETE FROM account_scores s USING accounts a WHERE a.id = s.account_id AND a.email LIKE 'bulk-%'`.execute(db());
    await sql`DELETE FROM accounts WHERE email LIKE 'bulk-%'`.execute(db());
  });

  it('runs in the housekeeping pass after its viewStats and before the purges, returns engagement, and logs one line', async () => {
    // A view of the day before, for this pass's viewStats to count.
    const device = (await db().insertInto('tracking_devices').values({ device_hash: 'e'.repeat(43), kind: 'PHONE', os: 'IOS', browser: 'SAFARI', first_seen_at: new Date('2026-11-15T10:00:00Z'), last_seen_at: new Date('2026-11-15T10:00:00Z') }).returning('id').executeTakeFirstOrThrow()).id;
    await db().insertInto('collector_views').values({ at: new Date('2026-11-15T10:00:00Z'), device_id: device, account_id: null, page: VIEW_PAGE_CODES.NOW, subject: null, seconds: 12, place_id: null }).execute();
    const counted = () => db().selectFrom('view_daily_stats').select('day').where('page', '=', 0).where('day', '=', '2026-11-15').execute();
    const seen: number[] = [];
    const real = svc.runIfDue.bind(svc);
    svc.runIfDue = async (now) => {
      seen.push((await counted()).length);
      return real(now);
    };
    const hk = startHousekeeping(h.ctx, { intervalMs: 3_600_000 });
    try {
      // Before the window: the job is not even asked.
      h.clock.set('2026-11-16T07:29:00.000Z');
      const early = await hk.runOnce();
      expect(early.engagement).toBe(0);
      expect(seen).toEqual([]);
      expect(await counted()).toEqual([]);
      // In the window: the views' days are counted first, then the scores.
      h.clock.set('2026-11-16T07:30:00.000Z');
      await db().updateTable('accounts').set({ status: 'DELETED' }).where('id', '=', (await db().selectFrom('account_scores').select('account_id').orderBy('account_id').executeTakeFirstOrThrow()).account_id).execute();
      lines.length = 0;
      const pass = await hk.runOnce();
      expect(Object.keys(pass).slice(9, 16)).toEqual(['viewStats', 'viewMonths', 'acquisitionDaily', 'wishMonths', 'engagement', 'collectorHistory', 'scanHistory']);
      expect(pass.viewStats).toBeGreaterThanOrEqual(1);
      expect(seen).toEqual([1]);
      // The rows changed: the row of the account deleted since the last run is removed.
      expect(pass.engagement).toBe(1);
      const line = lines.filter((l) => l.msg === 'engagement scores calculated');
      expect(line).toHaveLength(1);
      expect(line[0]!.level).toBe('info');
      expect(line[0]!.o).toEqual({ job: 'engagement', day: '2026-11-16', accounts: 5, changed: 1, ms: expect.any(Number) });
      // The next pass, 10 minutes later: asked again, nothing to do.
      h.clock.set('2026-11-16T07:40:00.000Z');
      expect((await hk.runOnce()).engagement).toBe(0);
      expect(seen).toHaveLength(2);
      expect((await runs()).filter((r) => r.day === '2026-11-16')).toHaveLength(1);
      // A failure is logged by the pass, never thrown; the other jobs go on.
      svc.runIfDue = async () => {
        throw new Error('the run failed');
      };
      h.clock.set('2026-11-17T08:00:00.000Z');
      lines.length = 0;
      const failed = await hk.runOnce();
      expect(failed.engagement).toBe(0);
      expect(lines.filter((l) => l.level === 'error')).toEqual([{ level: 'error', o: { job: 'engagement', err: { message: 'the run failed' } }, msg: 'housekeeping job failed' }]);
      expect(failed.sizes).toBeGreaterThan(0);
    } finally {
      svc.runIfDue = real;
      await hk.stop();
    }
  });
});
