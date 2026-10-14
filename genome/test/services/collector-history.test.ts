/**
 * The monthly history of each collector (plan CUSTOMER INTELLIGENCE §3.6 C.8 item 3, C.10, C.13 « collector-history.test.ts »
 * and « housekeeping.test.ts »; step 9.5; services/collector-history.ts, migration 0047): one story, month after month.
 *
 *   A   made 1 Jun 2025; a piece from 15 Mar 2026, four more from 10 Jul, one of them given back on 20 Aug (TITANE from
 *       March, PLATINE at July's end, TITANE again at August's); a sign-in on 10 May and a draw entry on 5 Sep.
 *   B   made 20 Jul 2026, nothing done.   C   made 5 Oct 2026 (in the current month on 14 Oct).
 *   T, H, X  a test entrant, one of the team's own accounts and a DELETED account: never a row.
 *
 *  - not run outside the morning window, nor while a test of test entrants is RUNNING;
 *  - the first deployment's back-fill (14 Oct 2026): the 12 months before October for A (tiers and activity from the
 *    ownership intervals and the acts, no score), B from its month; C, made this month, waits; logged once;
 *  - 1 Nov: the month just ended once that morning's scores are finished, with A's score; C gets its first row; a second
 *    pass writes nothing;
 *  - 1 Dec without the morning's scores: nothing before 12:00 UTC, then written with no score and logged; a run stopped
 *    in the middle resumes where it stopped; the 37th month drops the first, and a row too far behind starts again from
 *    the oldest month kept;
 *  - the housekeeping pass (1 Jan 2027): `collectorHistory` right after `engagement`, written with that morning's scores.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jsonText } from '../../src/server/db/schema.js';
import { startHousekeeping } from '../../src/server/context.js';
import {
  HISTORY_MAX_MONTHS,
  monthEnded,
  plusMonths,
  runCollectorHistory,
  tierOfPieces,
  writeMonth,
} from '../../src/server/services/collector-history.js';
import type { Logger } from '../../src/server/types.js';
import { GrowthWorld } from '../support/growth.js';
import { seedScore } from '../support/scores.js';
import { createAdmin, createHarness, type Harness } from '../api/support.js';

const z = (iso: string) => new Date(iso);

describe('the collectors’ monthly history (§3.6 C.10; step 9.5)', () => {
  let h: Harness;
  let w: GrowthWorld;
  const acc: Record<string, string> = {};
  const lines: { level: string; o: unknown; msg: string }[] = [];
  const log = {
    info: (o: unknown, msg: string) => void lines.push({ level: 'info', o, msg }),
    warn: (o: unknown, msg: string) => void lines.push({ level: 'warn', o, msg }),
    error: (o: unknown, msg: string) => void lines.push({ level: 'error', o, msg }),
  } as unknown as Logger;
  const noPause = { sleep: async () => {}, log };
  const db = () => h.t.db;
  const row = async (key: string) =>
    (await db().selectFrom('collector_history').select(['first_month', 'scores', 'tiers', 'active', 'last_month']).where('account_id', '=', acc[key]!).executeTakeFirst()) ?? null;
  const rows = async () => Number((await db().selectFrom('collector_history').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n);
  const finishRun = (day: string) =>
    db().insertInto('engagement_runs').values({ day, formula: 1, started_at: z(`${day}T07:30:00Z`), finished_at: z(`${day}T07:31:00Z`), accounts: 3, changed: 0, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], duration_ms: 50 }).execute();

  beforeAll(async () => {
    h = await createHarness();
    w = await new GrowthWorld(db()).prepare();
    const team = await createAdmin(h.ctx, 'AUDITOR');
    for (const [key, created] of [['A', '2025-06-01'], ['B', '2026-07-20'], ['C', '2026-10-05'], ['T', '2025-06-01'], ['H', '2025-06-01'], ['X', '2025-06-01'], ['D', '2023-01-10'], ['E', '2022-01-10']] as const) {
      const email = key === 'H' ? team.email : `history-${key.toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`;
      acc[key] = (await db().insertInto('accounts').values({ email, email_normalized: email.toLowerCase(), password_hash: 'x', created_at: z(`${created}T10:00:00Z`) }).returning('id').executeTakeFirstOrThrow()).id;
    }
    await db().insertInto('test_entrants').values({ account_id: acc.T! }).execute();
    const model = await w.model('MONOLITHE');
    await w.own(acc.A!, await w.piece(model), 'FIRST_REGISTRATION', '2026-03-15');
    for (let i = 0; i < 4; i++) await w.own(acc.A!, await w.piece(model), 'FIRST_REGISTRATION', '2026-07-10', i === 0 ? '2026-08-20' : undefined);
    for (const key of ['T', 'H', 'X']) await w.own(acc[key]!, await w.piece(model), 'FIRST_REGISTRATION', '2026-03-15');
    h.clock.set('2026-05-10T09:00:00Z');
    for (const key of ['A', 'T', 'H', 'X']) await h.ctx.audit.record({ actor: { type: 'account', id: acc[key]! }, action: 'account.login', targetType: 'account', targetId: acc[key]! });
    const drop = await w.drop({ mode: 'DRAW', modelId: model, title: 'MONOLITHE', opens: '2026-09-04', quantity: 5 });
    await w.drawEntry(drop.id, acc.A!, 'ENTERED', '2026-09-05');
    await db().updateTable('accounts').set({ status: 'DELETED' }).where('id', '=', acc.X!).execute();
  }, 120_000);
  afterAll(() => h?.close());

  it('reads months and tiers as the plan counts them', () => {
    expect(monthEnded(z('2026-11-01T08:00:00Z'))).toBe('2026-10-01');
    // 1 Nov 00:30 Paris is still 31 Oct in UTC: the month just ended is October.
    expect(monthEnded(z('2026-10-31T23:30:00Z'))).toBe('2026-10-01');
    expect(plusMonths('2026-01-01', -1)).toBe('2025-12-01');
    expect(plusMonths('2026-12-01', 1)).toBe('2027-01-01');
    expect([0, 1, 4, 5, 9, 10, 40].map(tierOfPieces)).toEqual([0, 1, 1, 2, 2, 3, 3]);
    expect(HISTORY_MAX_MONTHS).toBe(36);
  });

  it('is not run outside the morning window, nor while a test of test entrants is RUNNING', async () => {
    expect(await runCollectorHistory(db(), z('2026-10-14T07:29:00Z'), noPause)).toBe(0);
    const admin = await createAdmin(h.ctx, 'ADMIN');
    const drop = await w.drop({ mode: 'DRAW', modelId: await w.model('ORBITE'), title: 'ORBITE', opens: '2026-10-20', quantity: 5 });
    const run = await db().insertInto('test_runs').values({ drop_id: drop.id, mode: 'DRAW', status: 'RUNNING', settings: jsonText([]), entrants: 100, created_by: admin.id }).returning('id').executeTakeFirstOrThrow();
    expect(await runCollectorHistory(db(), z('2026-10-14T10:00:00Z'), noPause)).toBe(0);
    expect(await rows()).toBe(0);
    await db().deleteFrom('test_runs').where('id', '=', run.id).execute();
  });

  it('back-fills once, when the table is empty: the 12 months before the current one, tiers at each month’s end and activity, no score; logged', async () => {
    lines.length = 0;
    // D and E are made with rows of their own below; here they are back-filled too.
    expect(await runCollectorHistory(db(), z('2026-10-14T10:00:00Z'), noPause)).toBe(4);
    const zeros = (n: number) => Array(n).fill(0);
    expect(await row('A')).toEqual({
      first_month: '2025-10-01',
      scores: Array(12).fill(null),
      // Oct 2025 to Feb 2026 none; one piece from March; five at July's end; four at August's.
      tiers: [...zeros(5), 1, 1, 1, 1, 2, 1, 1],
      // A sign-in in May, a draw entry in September.
      active: [false, false, false, false, false, false, false, true, false, false, false, true],
      last_month: '2026-09-01',
    });
    expect(await row('B')).toEqual({ first_month: '2026-07-01', scores: [null, null, null], tiers: [0, 0, 0], active: [false, false, false], last_month: '2026-09-01' });
    for (const key of ['C', 'T', 'H', 'X']) expect(await row(key), key).toBeNull();
    // The Collectors page's options name the history's first month.
    expect((await h.ctx.services.collectorInsights.options()).snapshotsSince).toBe('2025-10-01');
    expect(lines.filter((l) => l.msg.startsWith('collector history back-filled'))).toEqual([
      { level: 'info', o: { job: 'collectorHistory', months: 12, collectors: 4 }, msg: 'collector history back-filled: 12 months, 4 collectors' },
    ]);
    // Once: the next pass (and the next days) write nothing.
    expect(await runCollectorHistory(db(), z('2026-10-14T10:10:00Z'), noPause)).toBe(0);
    expect(await runCollectorHistory(db(), z('2026-10-20T10:00:00Z'), noPause)).toBe(0);
  });

  it('on Paris day 1, writes the month just ended once the morning’s scores are finished, with them; a second pass writes nothing', async () => {
    await seedScore(db(), acc.A!, 64, z('2026-11-01T07:31:00Z'));
    // Before the morning's run is finished: it waits.
    expect(await runCollectorHistory(db(), z('2026-11-01T08:00:00Z'), noPause)).toBe(0);
    await finishRun('2026-11-01');
    expect(await runCollectorHistory(db(), z('2026-11-01T08:10:00Z'), noPause)).toBe(5);
    const a = (await row('A'))!;
    expect(a).toMatchObject({ first_month: '2025-10-01', last_month: '2026-10-01' });
    expect(a.scores).toEqual([...Array(12).fill(null), 64]);
    expect(a.tiers.slice(-2)).toEqual([1, 1]);
    expect(a.active.slice(-1)).toEqual([false]);
    // B appended, not measured; C, made in October, starts in October.
    expect(await row('B')).toEqual({ first_month: '2026-07-01', scores: [null, null, null, null], tiers: [0, 0, 0, 0], active: [false, false, false, false], last_month: '2026-10-01' });
    expect(await row('C')).toEqual({ first_month: '2026-10-01', scores: [null], tiers: [0], active: [false], last_month: '2026-10-01' });
    // Twice is harmless.
    expect(await runCollectorHistory(db(), z('2026-11-01T08:20:00Z'), noPause)).toBe(0);
    expect(await writeMonth(db(), '2026-10-01', { withScores: true, ...noPause })).toEqual({ rows: 0, created: 0 });
    expect((await row('A'))!.scores).toHaveLength(13);
  });

  it('without the morning’s scores: nothing before 12:00 UTC, then written with no score and logged; a run stopped in the middle resumes; the 37th month drops the first', async () => {
    // D holds 36 months ending in October, its first one active; E's row stopped in January 2023.
    const months = (n: number, v: unknown) => Array(n).fill(v);
    await db().updateTable('collector_history').set({ first_month: '2023-11-01', scores: months(36, null), tiers: months(36, 0), active: [true, ...months(35, false)], last_month: '2026-10-01' }).where('account_id', '=', acc.D!).execute();
    await db().updateTable('collector_history').set({ first_month: '2022-02-01', scores: months(12, 50), tiers: months(12, 0), active: months(12, true), last_month: '2023-01-01' }).where('account_id', '=', acc.E!).execute();
    lines.length = 0;
    expect(await runCollectorHistory(db(), z('2026-12-01T11:59:00Z'), noPause)).toBe(0);
    // A stop after the first batch of one; the rest is written by the next pass.
    await expect(
      writeMonth(db(), '2026-11-01', {
        withScores: false,
        batchSize: 1,
        sleep: async () => {
          throw new Error('restart');
        },
      }),
    ).rejects.toThrow('restart');
    expect((await db().selectFrom('collector_history').select('account_id').where('last_month', '=', '2026-11-01').execute()).length).toBe(1);
    expect(await runCollectorHistory(db(), z('2026-12-01T12:00:00Z'), noPause)).toBe(4);
    expect(lines.filter((l) => l.level === 'warn')).toEqual([{ level: 'warn', o: { job: 'collectorHistory', month: '2026-11', rows: 4 }, msg: 'collector history written without the morning’s score' }]);
    expect((await row('A'))!.scores).toEqual([...Array(12).fill(null), 64, null]);
    expect(await row('C')).toEqual({ first_month: '2026-10-01', scores: [null, null], tiers: [0, 0], active: [false, false], last_month: '2026-11-01' });
    // The 37th month drops the first: D starts a month later, still 36 months, its first activity gone.
    const d = (await row('D'))!;
    expect(d).toMatchObject({ first_month: '2023-12-01', last_month: '2026-11-01' });
    expect([d.scores.length, d.tiers.length, d.active.length]).toEqual([36, 36, 36]);
    expect(d.active.every((x) => x === false)).toBe(true);
    // E, 46 months behind: written again from the oldest month kept, its old months dropped.
    const e = (await row('E'))!;
    expect(e).toMatchObject({ first_month: plusMonths('2026-11-01', -35), last_month: '2026-11-01' });
    expect(e.scores).toEqual(Array(36).fill(null));
    expect(await runCollectorHistory(db(), z('2026-12-01T12:10:00Z'), noPause)).toBe(0);
  });

  it('runs in the housekeeping pass right after the engagement score, with that morning’s scores', async () => {
    const hk = startHousekeeping(h.ctx, { intervalMs: 3_600_000 });
    try {
      h.clock.set('2027-01-01T08:00:00Z');
      const pass = await hk.runOnce();
      const keys = Object.keys(pass);
      expect(keys.slice(keys.indexOf('engagement'), keys.indexOf('engagement') + 3)).toEqual(['engagement', 'collectorHistory', 'scanHistory']);
      expect(pass.collectorHistory).toBe(5);
      const score = await db().selectFrom('account_scores').select('score').where('account_id', '=', acc.A!).executeTakeFirst();
      expect((await row('A'))!.scores.at(-1)).toBe(score?.score ?? null);
      expect((await row('A'))!.last_month).toBe('2026-12-01');
      expect((await hk.runOnce()).collectorHistory).toBe(0);
    } finally {
      await hk.stop();
    }
  });
});
