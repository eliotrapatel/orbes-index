/**
 * ACTIVE AND DORMANT (plan CUSTOMER INTELLIGENCE §3.6 C.6.3 item 6; services/collector-insights.ts statusSql and
 * statusIs), read with EXISTS since the perf fix of genome-ci's first PostgreSQL run (INT-P2), on accounts made at the
 * edges of the rule: before the 90-day window and inside it, on the day before it starts, on the period's last day; with
 * no act, acts on the account's first Paris day only, an act exactly at the end of that day, at the window's start, at
 * the period's end, before the account was made; and each kind of act (a sign-in, a scan, a view, a draw entry, a LIVE
 * entry, an order). For several periods, each status equals:
 *
 *  - the rule computed here by hand (`never` with no act after the first Paris day, `active` with one in the 90 Paris
 *    days up to the period's end, `dormant` otherwise);
 *  - the form it replaces, kept here as the reference: the latest act of each kind (six max()) compared with the end of
 *    the first day and the window's start;
 *  - statusIs, the lists' condition, for each of the three statuses.
 */
import { randomUUID } from 'node:crypto';
import { sql, type RawBuilder } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidArray } from '../../src/server/db/connection.js';
import { dayStarts, ENGAGEMENT_ACTIVE_DAYS, ENGAGEMENT_STATUSES, statusIs, statusSql } from '../../src/server/services/collector-insights.js';
import { parisPeriod, plusDays, previousPeriod, type Period } from '../../src/server/services/insights-scope.js';
import { parisDay, parisDayStart } from '../../src/server/services/schedule.js';
import { GrowthWorld } from '../support/growth.js';
import { createHarness, type Harness } from '../api/support.js';

const z = (iso: string) => new Date(iso);

/** The previous form (step 9.14 to INT-M3), the reference: the latest act of each kind before the period's end. */
function previousStatusSql(p: Pick<Period, 'to' | 'end'>, starts: RawBuilder<unknown>): RawBuilder<string> {
  const windowStart = parisDayStart(plusDays(p.to, -(ENGAGEMENT_ACTIVE_DAYS - 1)));
  const e = sql`${p.end}::timestamptz`;
  const la = sql`greatest(
    (SELECT max(ail.occurred_at) FROM audit_logs ail WHERE ail.action = 'account.login' AND ail.target_id = c.account_id::text AND ail.occurred_at < ${e}),
    (SELECT max(ais.occurred_at) FROM scan_events ais WHERE ais.account_id = c.account_id AND ais.occurred_at < ${e}),
    (SELECT max(aiv.at) FROM collector_views aiv WHERE aiv.account_id = c.account_id AND aiv.at < ${e}),
    (SELECT max(aid.created_at) FROM drop_entries aid WHERE aid.account_id = c.account_id AND aid.created_at < ${e}),
    (SELECT max(aie.joined_at) FROM live_entries aie WHERE aie.account_id = c.account_id AND aie.joined_at < ${e}),
    (SELECT max(aio.reserved_at) FROM orders aio WHERE aio.account_id = c.account_id AND aio.reserved_at < ${e}))`;
  const fe = sql`(${starts})[width_bucket(c.created_at, ${starts}) + 1]`;
  return sql<string>`(SELECT CASE WHEN st.la IS NULL OR st.la < st.fe THEN 'never' WHEN st.la >= greatest(st.fe, ${windowStart}::timestamptz) THEN 'active' ELSE 'dormant' END
      FROM (SELECT ${la} AS la, ${fe} AS fe OFFSET 0) st)`;
}

describe('ACTIVE AND DORMANT read with EXISTS (statusSql, statusIs)', () => {
  let h: Harness;
  let w: GrowthWorld;
  let model = '';
  let device = 0;
  const acc: Record<string, string> = {};
  const made: Record<string, Date> = {};
  /** Every act of each account, at its instant (the rule by hand reads these). */
  const acts: Record<string, Date[]> = {};
  const now = z('2026-10-14T09:00:00Z');
  const P30 = parisPeriod({ p: '30d' }, now);
  // The window of P30: 17 July to 14 October (Paris), so it starts at 2026-07-16T22:00:00Z.
  const WS = parisDayStart(plusDays(P30.to, -(ENGAGEMENT_ACTIVE_DAYS - 1)));

  const make = async (key: string, created: string) => {
    const email = `status-${key.toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`;
    acc[key] = (
      await h.t.db
        .insertInto('accounts')
        .values({ email, email_normalized: email.toLowerCase(), password_hash: 'x', country: 'FR', status: 'ACTIVE', created_at: z(created) })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    made[key] = z(created);
    acts[key] = [];
  };
  const login = async (key: string, at: Date) => {
    h.clock.set(at.toISOString());
    await h.ctx.audit.record({ actor: { type: 'account', id: acc[key]! }, action: 'account.login', targetType: 'account', targetId: acc[key]! });
    acts[key]!.push(at);
  };
  const scan = async (key: string, at: Date) => {
    await h.t.db.insertInto('scan_events').values({ occurred_at: at, event_type: 'VERIFY', account_id: acc[key]!, result_state: 'AUTHENTIC' } as never).execute();
    acts[key]!.push(at);
  };
  const view = async (key: string, at: Date) => {
    await h.t.db.insertInto('collector_views').values({ at, device_id: device, account_id: acc[key]!, page: 2, subject: null, seconds: 5, place_id: null }).execute();
    acts[key]!.push(at);
  };

  /** The rule by hand. */
  const byHand = (key: string, p: Period): string => {
    const firstEnd = parisDayStart(plusDays(parisDay(made[key]!), 1));
    const before = acts[key]!.filter((t) => t < p.end).map((t) => t.getTime());
    const last = before.length ? Math.max(...before) : null;
    if (last === null || last < firstEnd.getTime()) return 'never';
    const windowStart = parisDayStart(plusDays(p.to, -(ENGAGEMENT_ACTIVE_DAYS - 1)));
    return last >= Math.max(firstEnd.getTime(), windowStart.getTime()) ? 'active' : 'dormant';
  };
  const keyOf = (id: string) => Object.entries(acc).find(([, v]) => v === id)![0];
  /** The accounts of this file made by the period's end, as the scope CTE `c` gives them. */
  const col = (p: Period) => sql`(SELECT a.id AS account_id, a.created_at FROM accounts a WHERE a.id = ANY(${uuidArray(Object.values(acc))}) AND a.created_at < ${p.end}::timestamptz) c`;
  const startsOf = (p: Period) => dayStarts(new Date(Math.min(...Object.values(made).map((d) => d.getTime()))), p.to);
  const read = async (p: Period, expr: (p: Period, starts: RawBuilder<unknown>) => RawBuilder<unknown>) =>
    Object.fromEntries(
      (await sql<{ account_id: string; st: string }>`SELECT c.account_id, ${expr(p, startsOf(p))} AS st FROM ${col(p)}`.execute(h.t.db)).rows
        .map((r) => [keyOf(r.account_id), r.st] as const)
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    );

  beforeAll(async () => {
    h = await createHarness();
    w = await new GrowthWorld(h.t.db).prepare();
    model = await w.model('MONOLITHE', { price: [48_000, 'EUR'] });
    device = (await h.t.db.insertInto('tracking_devices').values({ device_hash: `status__${'d'.repeat(35)}`, first_seen_at: z('2026-01-01T00:00:00Z'), last_seen_at: z('2026-01-01T00:00:00Z') }).returning('id').executeTakeFirstOrThrow()).id;
    // Made before the window (1 March, 11:00 Paris: its first day ends at 2026-03-01T23:00:00Z).
    await make('OLD_ACTIVE', '2026-03-01T10:00:00Z');
    await login('OLD_ACTIVE', z('2026-09-20T10:00:00Z'));
    await make('OLD_DORMANT', '2026-03-01T10:00:00Z');
    await scan('OLD_DORMANT', z('2026-05-10T10:00:00Z'));
    await make('OLD_FIRST_DAY', '2026-03-01T10:00:00Z');
    await view('OLD_FIRST_DAY', z('2026-03-01T22:59:59Z'));
    await make('OLD_NO_ACT', '2026-03-01T10:00:00Z');
    await make('OLD_AT_FIRST_DAY_END', '2026-03-01T10:00:00Z');
    await view('OLD_AT_FIRST_DAY_END', z('2026-03-01T23:00:00Z'));
    await make('OLD_AT_WINDOW_START', '2026-03-01T10:00:00Z');
    await scan('OLD_AT_WINDOW_START', WS);
    await scan('OLD_AT_WINDOW_START', z('2026-04-01T10:00:00Z'));
    await make('OLD_AT_END', '2026-03-01T10:00:00Z');
    await login('OLD_AT_END', P30.end);
    await make('OLD_BEFORE_WINDOW_AND_AT_END', '2026-03-01T10:00:00Z');
    await view('OLD_BEFORE_WINDOW_AND_AT_END', z('2026-07-16T21:59:59Z'));
    await view('OLD_BEFORE_WINDOW_AND_AT_END', P30.end);
    // Made the day before the window starts: its first day ends at the window's start.
    await make('EVE_AT_WINDOW_START', '2026-07-16T10:00:00Z');
    await login('EVE_AT_WINDOW_START', WS);
    await make('EVE_FIRST_DAY', '2026-07-16T10:00:00Z');
    await view('EVE_FIRST_DAY', z('2026-07-16T21:59:59Z'));
    // Made inside the window.
    await make('NEW_ACTIVE', '2026-09-01T10:00:00Z');
    await login('NEW_ACTIVE', z('2026-09-03T10:00:00Z'));
    await make('NEW_FIRST_DAY', '2026-09-01T10:00:00Z');
    await scan('NEW_FIRST_DAY', z('2026-09-01T21:59:59Z'));
    await make('NEW_NO_ACT', '2026-09-01T10:00:00Z');
    await make('ON_WINDOW_START', WS.toISOString());
    await view('ON_WINDOW_START', z('2026-07-17T22:00:00Z'));
    await make('ON_WINDOW_START_FIRST_DAY', WS.toISOString());
    await view('ON_WINDOW_START_FIRST_DAY', new Date(WS.getTime() + 3_600_000));
    await make('LAST_DAY', '2026-10-14T06:00:00Z');
    await login('LAST_DAY', z('2026-10-14T08:00:00Z'));
    // An act before the account was made (browsing linked at sign-up): never one after its first day.
    await make('BEFORE_SIGN_UP', '2026-05-01T10:00:00Z');
    await view('BEFORE_SIGN_UP', z('2026-04-20T10:00:00Z'));
    // The other kinds of act: a draw entry, a LIVE entry, an order (each at its helper's instant).
    await make('DRAW', '2026-03-01T10:00:00Z');
    const draw = await w.drop({ mode: 'DRAW', modelId: model, title: 'DRAW', opens: '2026-08-01', quantity: 5 });
    await w.drawEntry(draw.id, acc.DRAW!, 'ENTERED', '2026-08-01');
    acts.DRAW!.push(z('2026-08-01T12:00:00Z'));
    await make('LIVE', '2026-03-01T10:00:00Z');
    const live = await w.drop({ mode: 'LIVE', modelId: model, title: 'LIVE', opens: '2026-05-15', quantity: 3 });
    await w.liveEntry(live, acc.LIVE!, '2026-05-15');
    acts.LIVE!.push(new Date(z('2026-05-15T12:00:00Z').getTime() - 600_000));
    await make('ORDER', '2026-03-01T10:00:00Z');
    await w.order({ accountId: acc.ORDER!, modelId: model, channel: 'SALON', paid: '2026-09-30', total: 10_000, currency: 'EUR' });
    acts.ORDER!.push(z('2026-09-30T11:00:00Z'));
  }, 60_000);
  afterAll(() => h?.close());

  it('as of LAST 30 DAYS: each account at the edges of the rule', async () => {
    expect(await read(P30, statusSql)).toEqual({
      BEFORE_SIGN_UP: 'never',
      DRAW: 'active',
      EVE_AT_WINDOW_START: 'active',
      EVE_FIRST_DAY: 'never',
      LAST_DAY: 'never',
      LIVE: 'dormant',
      NEW_ACTIVE: 'active',
      NEW_FIRST_DAY: 'never',
      NEW_NO_ACT: 'never',
      OLD_ACTIVE: 'active',
      OLD_AT_END: 'never',
      OLD_AT_FIRST_DAY_END: 'dormant',
      OLD_AT_WINDOW_START: 'active',
      OLD_BEFORE_WINDOW_AND_AT_END: 'dormant',
      OLD_DORMANT: 'dormant',
      OLD_FIRST_DAY: 'never',
      OLD_NO_ACT: 'never',
      ON_WINDOW_START: 'active',
      ON_WINDOW_START_FIRST_DAY: 'never',
      ORDER: 'active',
    });
  });

  it('for every period, the rule by hand, the six max() it replaces and statusIs give the same statuses', async () => {
    const periods = [
      P30,
      previousPeriod(P30),
      parisPeriod({ p: '12m' }, now),
      parisPeriod({ p: '7d' }, z('2026-08-01T09:00:00Z')),
      parisPeriod({ p: '30d' }, z('2026-07-17T09:00:00Z')),
      parisPeriod({ p: '30d' }, z('2026-09-02T09:00:00Z')),
    ];
    for (const p of periods) {
      const exists = await read(p, statusSql);
      const previous = await read(p, previousStatusSql);
      const hand = Object.fromEntries(Object.keys(exists).map((k) => [k, byHand(k, p)]));
      expect(exists, `${p.from} to ${p.to}: by hand`).toEqual(hand);
      expect(exists, `${p.from} to ${p.to}: the six max()`).toEqual(previous);
      expect(Object.keys(exists).length, `${p.from} to ${p.to}`).toBe(Object.values(made).filter((d) => d < p.end).length);
      for (const status of ENGAGEMENT_STATUSES) {
        const r = await sql<{ account_id: string }>`SELECT c.account_id FROM ${col(p)} WHERE ${statusIs(p, startsOf(p), status)}`.execute(h.t.db);
        expect(r.rows.map((x) => keyOf(x.account_id)).sort(), `${p.from} to ${p.to}: ${status}`).toEqual(Object.keys(exists).filter((k) => exists[k] === status).sort());
      }
    }
    // Each status is met in these periods.
    const seen = new Set(Object.values(await read(P30, statusSql)));
    expect([...seen].sort()).toEqual([...ENGAGEMENT_STATUSES].sort());
  });
});
