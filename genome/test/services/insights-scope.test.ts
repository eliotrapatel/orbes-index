/**
 * The Collectors page's scope (plan CUSTOMER INTELLIGENCE §3.6 C.6.2, C.6.4, C.6.8, C.13 « insights-scope.test.ts »;
 * step 9.1; services/insights-scope.ts):
 *
 *  - parisPeriod for LAST 7, 30, 90 DAYS, LAST 12 MONTHS and CUSTOM, rolling Paris days up to today, across 25 October
 *    2026 (the change to winter time: a 25-hour day counted once), CUSTOM's bounds (1 Jan 2026, today, 731 days apart,
 *    `from` not after `to`), and previousPeriod;
 *  - periodBuckets by day, ISO week and month, each day in one bucket;
 *  - ageBand on birthdays: the day before, the day of, 29 February (on 28 February in a common year); ageBandSql gives
 *    the same band as ageBand for every date of birth of a range, on the database;
 *  - parseFilters: the five filters read, sorted and once, refused in their words; filtersKey equal for equal views;
 *  - activeIn: a sign-in, a scan, a view, a draw entry, a LIVE entry, an order, each inside [start, end), none at `end`;
 *  - scopeCte: counted collectors only (no test entrant, no team account, no DELETED account; LOCKED kept), each filter,
 *    the tier from the pieces held now (an ended ownership and a REVOKED piece not counted), the score now, the scopes.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ageBand as bandOfAge, ageOn } from '../../src/shared/profile-rules.js';
import {
  activeIn,
  AGE_SLICES,
  ageBand,
  ageBandSql,
  bucketUnit,
  CUSTOM_PROBLEM,
  filtersKey,
  isoWeek,
  NO_FILTERS,
  parseFilters,
  parisPeriod,
  periodBuckets,
  plusDays,
  previousPeriod,
  scopeCte,
  type InsightsFilters,
  type Scope,
} from '../../src/server/services/insights-scope.js';
import { GrowthWorld } from '../support/growth.js';
import { seedScore } from '../support/scores.js';
import { createAdmin, createHarness, type Harness } from '../api/support.js';

const z = (iso: string) => new Date(iso);
const H = 3_600_000;

describe('parisPeriod and previousPeriod (§3.6 C.6.2)', () => {
  const now = z('2026-10-14T09:00:00Z'); // 11:00 Paris, 14 October

  it('LAST N DAYS is today and the N − 1 Paris days before; LAST 12 MONTHS today and the 364 before; 30 days by default', () => {
    expect(parisPeriod({ p: '7d' }, now)).toMatchObject({ key: '7d', from: '2026-10-08', to: '2026-10-14', days: 7 });
    expect(parisPeriod({ p: '30d' }, now)).toMatchObject({ key: '30d', from: '2026-09-15', to: '2026-10-14', days: 30 });
    expect(parisPeriod({ p: '90d' }, now)).toMatchObject({ key: '90d', from: '2026-07-17', to: '2026-10-14', days: 90 });
    expect(parisPeriod({ p: '12m' }, now)).toMatchObject({ key: '12m', from: '2025-10-15', to: '2026-10-14', days: 365 });
    expect(parisPeriod({}, now)).toMatchObject({ key: '30d', from: '2026-09-15', to: '2026-10-14' });
    const p = parisPeriod({ p: '7d' }, now);
    expect(p.start.toISOString()).toBe('2026-10-07T22:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-10-14T22:00:00.000Z');
  });

  it('today is the Paris day: 23:30 UTC on 14 October is already 15 October in Paris', () => {
    expect(parisPeriod({ p: '7d' }, z('2026-10-14T22:30:00Z'))).toMatchObject({ from: '2026-10-09', to: '2026-10-15' });
    expect(parisPeriod({ p: '7d' }, z('2026-11-14T22:30:00Z'))).toMatchObject({ from: '2026-11-08', to: '2026-11-14' }); // 23:30 CET
  });

  it('across 25 October 2026: seven Paris days are 169 hours, the 25-hour day counted once', () => {
    const p = parisPeriod({ p: '7d' }, z('2026-10-28T10:00:00Z'));
    expect(p).toMatchObject({ from: '2026-10-22', to: '2026-10-28', days: 7 });
    expect(p.start.toISOString()).toBe('2026-10-21T22:00:00.000Z'); // CEST
    expect(p.end.toISOString()).toBe('2026-10-28T23:00:00.000Z'); // CET
    expect((p.end.getTime() - p.start.getTime()) / H).toBe(169);
    const before = previousPeriod(p);
    expect(before).toMatchObject({ key: '7d', from: '2026-10-15', to: '2026-10-21', days: 7 });
    expect((before.end.getTime() - before.start.getTime()) / H).toBe(168);
    expect(before.end.getTime()).toBe(p.start.getTime());
  });

  it('the previous period is the same number of days, ending the day before the period starts', () => {
    expect(previousPeriod(parisPeriod({ p: '30d' }, now))).toMatchObject({ from: '2026-08-16', to: '2026-09-14', days: 30 });
    expect(previousPeriod(parisPeriod({ p: '12m' }, now))).toMatchObject({ from: '2024-10-15', to: '2025-10-14', days: 365 });
    const custom = parisPeriod({ p: 'custom', from: '2026-03-01', to: '2026-03-31' }, now);
    expect(custom).toMatchObject({ key: 'custom', from: '2026-03-01', to: '2026-03-31', days: 31 });
    // 29 March 2026 is a 23-hour day: the period's instants follow it.
    expect((custom.end.getTime() - custom.start.getTime()) / H).toBe(31 * 24 - 1);
    expect(previousPeriod(custom)).toMatchObject({ from: '2026-01-29', to: '2026-02-28', days: 31 });
  });

  it('CUSTOM: from 1 Jan 2026 to today, at most 731 days apart, from not after to; otherwise 400 in the page’s words', () => {
    const later = z('2028-01-05T12:00:00Z');
    expect(parisPeriod({ p: 'custom', from: '2026-01-01', to: '2028-01-02' }, later)).toMatchObject({ days: 732 });
    const refused = [
      { from: '2025-12-31', to: '2026-01-10' },
      { from: '2026-01-01', to: '2028-01-03' }, // 732 days apart
      { from: '2026-10-10', to: '2026-10-09' },
      { from: '2026-10-10', to: '2028-01-06' }, // after today
      { from: '2026-02-30', to: '2026-03-01' },
      { from: '2026-01-01' },
      {},
    ];
    for (const r of refused) {
      expect(() => parisPeriod({ p: 'custom', ...r }, later), JSON.stringify(r)).toThrow(CUSTOM_PROBLEM);
    }
    expect(CUSTOM_PROBLEM).toBe('Choose dates from 1 Jan 2026 to today, at most two years apart.');
    expect(() => parisPeriod({ p: '14d' }, now)).toThrow(/7d, 30d, 90d, 12m, custom/);
  });
});

describe('periodBuckets (§3.6 C.6.3: by day up to 31 days, by week up to 120, by month beyond)', () => {
  const all = (b: ReturnType<typeof periodBuckets>) => b.flatMap((x) => {
    const out: string[] = [];
    for (let d = x.from; d <= x.to; d = plusDays(d, 1)) out.push(d);
    return out;
  });

  it('cuts by day, ISO week or month, each Paris day in exactly one bucket, the ends cut to the period', () => {
    const now = z('2026-10-14T09:00:00Z');
    const days = periodBuckets(parisPeriod({ p: '30d' }, now));
    expect(bucketUnit({ days: 31 })).toBe('day');
    expect(days).toHaveLength(30);
    expect(days[0]).toMatchObject({ key: '2026-09-15', from: '2026-09-15', to: '2026-09-15' });
    const weeks = periodBuckets(parisPeriod({ p: '90d' }, now));
    expect(bucketUnit({ days: 90 })).toBe('week');
    expect(weeks[0]).toMatchObject({ key: '2026-W29', from: '2026-07-17', to: '2026-07-19' }); // a Friday to its Sunday
    expect(weeks[1]).toMatchObject({ key: '2026-W30', from: '2026-07-20', to: '2026-07-26' });
    expect(weeks[weeks.length - 1]).toMatchObject({ key: '2026-W42', from: '2026-10-12', to: '2026-10-14' });
    const months = periodBuckets(parisPeriod({ p: '12m' }, now));
    expect(bucketUnit({ days: 121 })).toBe('month');
    expect(months.map((m) => m.key)).toEqual(['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(months[0]).toMatchObject({ from: '2025-10-15', to: '2025-10-31' });
    for (const p of [days, weeks, months]) {
      const list = all(p);
      expect(new Set(list).size).toBe(list.length);
      for (let i = 1; i < p.length; i++) expect(p[i]!.start.getTime()).toBe(p[i - 1]!.end.getTime());
    }
    expect(all(weeks)).toHaveLength(90);
    expect(all(months)).toHaveLength(365);
    // The bucket of the change to winter time holds its 25 hours.
    const oct = periodBuckets({ from: '2026-10-25', to: '2026-10-25', days: 1 })[0]!;
    expect((oct.end.getTime() - oct.start.getTime()) / H).toBe(25);
  });

  it('isoWeek: the week’s Thursday decides its year', () => {
    expect(isoWeek('2026-09-14')).toBe('2026-W38');
    expect(isoWeek('2026-12-31')).toBe('2026-W53');
    expect(isoWeek('2027-01-03')).toBe('2026-W53');
    expect(isoWeek('2027-01-04')).toBe('2027-W01');
    expect(isoWeek('2024-12-30')).toBe('2025-W01');
  });
});

describe('ageBand (§3.6 C.6.3 AGES, C.13)', () => {
  it('the day before a birthday, the day of it, and 29 February', () => {
    expect(ageBand(null, '2026-10-14')).toBe('none');
    expect(ageBand('2008-10-15', '2026-10-14')).toBe('under18'); // 17, the day before
    expect(ageBand('2008-10-14', '2026-10-14')).toBe('18-24'); // 18, the day of
    expect(ageBand('2001-10-15', '2026-10-14')).toBe('18-24'); // 24
    expect(ageBand('2001-10-14', '2026-10-14')).toBe('25-34');
    expect(ageBand('1961-10-15', '2026-10-14')).toBe('55-64');
    expect(ageBand('1961-10-14', '2026-10-14')).toBe('65plus');
    // Born on 29 February 2008: 18 on 28 February 2026 (a common year), 17 the day before.
    expect(ageBand('2008-02-29', '2026-02-27')).toBe('under18');
    expect(ageBand('2008-02-29', '2026-02-28')).toBe('18-24');
    expect(ageBand('2004-02-29', '2029-02-27')).toBe('18-24'); // 24 the day before 28 February 2029
    expect(ageBand('2004-02-29', '2029-02-28')).toBe('25-34'); // 25 on 28 February of a common year
    expect(ageBand('2007-02-28', '2025-02-28')).toBe('18-24');
    expect(AGE_SLICES).toEqual(['under18', '18-24', '25-34', '35-44', '45-54', '55-64', '65plus', 'none']);
  });
});

describe('parseFilters and filtersKey (§3.6 C.6.2)', () => {
  const CH = '6b7f1a2e-0000-4000-8000-00000000000a';

  it('reads the five filters, sorted and once', () => {
    expect(parseFilters({})).toEqual(NO_FILTERS);
    const f = parseFilters({ c: 'it,FR,fr', s: `kind:SITE,${CH.toUpperCase()},kind:BEFORE`, t: '3,0,2,0', sc: '40-100', ft: 'cuff, ring ,RING' });
    expect(f).toEqual({ countries: ['FR', 'IT'], sources: { channelIds: [CH], kinds: ['BEFORE', 'SITE'] }, tiers: [0, 2, 3], score: { min: 40, max: 100 }, types: ['CUFF', 'RING'] });
    expect(filtersKey(f)).toBe(filtersKey(parseFilters({ c: 'FR,IT', s: `kind:BEFORE,kind:SITE,${CH}`, t: '0,2,3', sc: '40 - 100', ft: 'RING,CUFF' })));
    expect(filtersKey(f)).not.toBe(filtersKey(parseFilters({ c: 'FR' })));
    expect(parseFilters({ sc: '0-0' }).score).toEqual({ min: 0, max: 0 });
  });

  it('refuses each filter in its words', () => {
    expect(() => parseFilters({ c: 'FRA' })).toThrow(/^c: /);
    expect(() => parseFilters({ s: 'instagram' })).toThrow(/^s: /);
    expect(() => parseFilters({ s: 'kind:LINK' })).toThrow(/^s: /);
    expect(() => parseFilters({ t: '4' })).toThrow(/^t: /);
    expect(() => parseFilters({ sc: '60-40' })).toThrow(/^sc: /);
    expect(() => parseFilters({ sc: '0-101' })).toThrow(/^sc: /);
    expect(() => parseFilters({ sc: '40' })).toThrow(/^sc: /);
    const codes = Array.from({ length: 51 }, (_, i) => `${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`);
    expect(parseFilters({ c: codes.slice(0, 50).join(',') }).countries).toHaveLength(50);
    expect(() => parseFilters({ c: codes.join(',') })).toThrow('c: at most 50.');
  });
});

describe('activeIn and scopeCte on the database (§3.6 C.6.2, C.6.4, C.6.8)', () => {
  let h: Harness;
  let w: GrowthWorld;
  const acc: Record<string, string> = {};
  const START = z('2026-10-01T00:00:00Z');
  const END = z('2026-10-08T00:00:00Z');
  let model = '';
  let device = 0;

  const make = async (key: string, o: { country?: string | null; created?: string; status?: 'ACTIVE' | 'LOCKED' | 'DELETED'; email?: string } = {}) => {
    const email = o.email ?? `scope-${key.toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`;
    acc[key] = (
      await h.t.db
        .insertInto('accounts')
        .values({ email, email_normalized: email.toLowerCase(), password_hash: 'x', country: o.country === undefined ? 'FR' : o.country, status: o.status ?? 'ACTIVE', created_at: z(o.created ?? '2026-09-01T10:00:00Z') })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    return acc[key]!;
  };
  const login = async (key: string, at: string) => {
    h.clock.set(at);
    await h.ctx.audit.record({ actor: { type: 'account', id: acc[key]! }, action: 'account.login', targetType: 'account', targetId: acc[key]! });
  };
  const scoped = async (filters: InsightsFilters, scope: Scope = 'all') =>
    (await sql<{ account_id: string; tier: number; score: number | null }>`WITH ${scopeCte('col', { filters, scope }, { start: START, end: END })} SELECT account_id, tier, score FROM col`.execute(h.t.db)).rows;
  const keysOf = (rows: { account_id: string }[]) =>
    rows
      .map((r) => Object.entries(acc).find(([, id]) => id === r.account_id)?.[0] ?? '?')
      .filter((k) => k !== '?')
      .sort();

  beforeAll(async () => {
    h = await createHarness();
    w = await new GrowthWorld(h.t.db).prepare();
    model = await w.model('MONOLITHE', { price: [48_000, 'EUR'] });
    device = (await h.t.db.insertInto('tracking_devices').values({ device_hash: `scope___${'d'.repeat(35)}`, first_seen_at: START, last_seen_at: START }).returning('id').executeTakeFirstOrThrow()).id;
    // Activity: one kind each, inside the period; END itself is outside.
    // Sign-ins, recorded at their instant (the audit log takes the clock's time).
    await make('BEFORE');
    await login('BEFORE', '2026-09-30T23:59:59Z');
    await make('LOGIN');
    await login('LOGIN', '2026-10-03T10:00:00Z');
    await make('SCAN');
    await h.t.db.insertInto('scan_events').values({ occurred_at: z('2026-10-02T10:00:00Z'), event_type: 'VERIFY', account_id: acc.SCAN!, result_state: 'AUTHENTIC' } as never).execute();
    await make('VIEW');
    await h.t.db.insertInto('collector_views').values({ at: z('2026-10-07T23:59:59Z'), device_id: device, account_id: acc.VIEW!, page: 2, subject: null, seconds: 5, place_id: null }).execute();
    await make('DRAW');
    const draw = await w.drop({ mode: 'DRAW', modelId: model, title: 'DRAW', opens: '2026-10-04', quantity: 5 });
    await w.drawEntry(draw.id, acc.DRAW!, 'ENTERED', '2026-10-04');
    await make('LIVE');
    const live = await w.drop({ mode: 'LIVE', modelId: model, title: 'LIVE', opens: '2026-10-05', quantity: 3 });
    await w.liveEntry(live, acc.LIVE!, '2026-10-05');
    await make('ORDER');
    await w.order({ accountId: acc.ORDER!, modelId: model, channel: 'SALON', paid: '2026-10-06', total: 10_000, currency: 'EUR' });
    await make('AT_END');
    await h.t.db.insertInto('scan_events').values({ occurred_at: END, event_type: 'VERIFY', account_id: acc.AT_END!, result_state: 'AUTHENTIC' } as never).execute();
    await make('IDLE', { country: 'IT', created: '2026-10-05T10:00:00Z' });
    // Who is counted.
    await make('LOCKED', { status: 'LOCKED', country: 'GB' });
    await make('DELETED', { status: 'DELETED' });
    await make('TEST');
    await h.t.db.insertInto('test_entrants').values({ account_id: acc.TEST! }).execute();
    const team = await createAdmin(h.ctx, 'AUDITOR');
    await make('TEAM', { email: team.email });
    // Tiers: 5 pieces held (PLATINE); 10 held, one more ended and one REVOKED (PALLADIUM); 1 held (TITANE).
    await make('PLATINE', { country: null });
    for (let i = 0; i < 5; i++) await w.own(acc.PLATINE!, await w.piece(model), 'FIRST_REGISTRATION', '2026-02-01');
    await make('PALLADIUM');
    for (let i = 0; i < 10; i++) await w.own(acc.PALLADIUM!, await w.piece(model), 'FIRST_REGISTRATION', '2026-02-01');
    await w.own(acc.PALLADIUM!, await w.piece(model), 'FIRST_REGISTRATION', '2026-02-01', '2026-03-01');
    const revoked = await w.piece(model);
    await h.t.db.updateTable('products').set({ status: 'REVOKED' }).where('id', '=', revoked).execute();
    await w.own(acc.PALLADIUM!, revoked, 'FIRST_REGISTRATION', '2026-02-01');
    await make('NINE');
    for (let i = 0; i < 9; i++) await w.own(acc.NINE!, await w.piece(model), 'FIRST_REGISTRATION', '2026-02-01');
    // Scores, a favourite piece.
    await seedScore(h.t.db, acc.LOGIN!, 40, START);
    await seedScore(h.t.db, acc.SCAN!, 100, START);
    await seedScore(h.t.db, acc.VIEW!, 39, START);
    for (const [k, key] of [['DRAW', 'RING'], ['LIVE', 'CUFF'], ['ORDER', 'RING']] as const) {
      await h.t.db.insertInto('account_tastes').values({ account_id: acc[k]!, kind: 'PIECE', value_key: key, label: key }).execute();
    }
    await h.t.db.insertInto('account_tastes').values({ account_id: acc.IDLE!, kind: 'FINISH', value_key: 'RING', label: 'RING' }).execute();
  }, 60_000);
  afterAll(() => h?.close());

  it('activeIn: a sign-in, a scan, a view, a draw entry, a LIVE entry, an order; nothing at the period’s end or before it', async () => {
    const rows = await sql<{ id: string }>`SELECT a.id FROM accounts a WHERE ${activeIn('a.id', START, END)}`.execute(h.t.db);
    expect(keysOf(rows.rows.map((r) => ({ account_id: r.id })))).toEqual(['DRAW', 'LIVE', 'LOGIN', 'ORDER', 'SCAN', 'VIEW']);
  });

  it('scopeCte: counted collectors only (LOCKED kept), the tier from the pieces held now, the score now', async () => {
    const rows = await scoped(NO_FILTERS);
    expect(keysOf(rows)).toEqual(['AT_END', 'BEFORE', 'DRAW', 'IDLE', 'LIVE', 'LOCKED', 'LOGIN', 'NINE', 'ORDER', 'PALLADIUM', 'PLATINE', 'SCAN', 'VIEW']);
    const tier = (k: string) => Number(rows.find((r) => r.account_id === acc[k])!.tier);
    expect([tier('PLATINE'), tier('PALLADIUM'), tier('NINE'), tier('IDLE')]).toEqual([2, 3, 2, 0]);
    expect(rows.find((r) => r.account_id === acc.SCAN)!.score).toBe(100);
    expect(rows.find((r) => r.account_id === acc.IDLE)!.score).toBeNull();
  });

  it('scopeCte: each filter alone and combined, and the three scopes', async () => {
    const f = (raw: Parameters<typeof parseFilters>[0]) => parseFilters(raw);
    expect(keysOf(await scoped(f({ c: 'IT,GB' })))).toEqual(['IDLE', 'LOCKED']);
    expect(keysOf(await scoped(f({ t: '3' })))).toEqual(['PALLADIUM']);
    expect(keysOf(await scoped(f({ t: '2' })))).toEqual(['NINE', 'PLATINE']);
    expect((await scoped(f({ t: '0' }))).length).toBe(10);
    expect(keysOf(await scoped(f({ sc: '40-100' })))).toEqual(['LOGIN', 'SCAN']);
    expect(keysOf(await scoped(f({ ft: 'ring' })))).toEqual(['DRAW', 'ORDER']); // a FINISH never counts as a piece
    expect(keysOf(await scoped(f({ ft: 'RING,CUFF', c: 'FR' })))).toEqual(['DRAW', 'LIVE', 'ORDER']);
    expect(keysOf(await scoped(f({ ft: 'RING', sc: '0-100' })))).toEqual([]);
    // No recording: every counted collector came first « Before tracking ».
    expect((await scoped(f({ s: 'kind:BEFORE' }))).length).toBe(13);
    expect((await scoped(f({ s: 'kind:DIRECT' }))).length).toBe(0);
    expect(keysOf(await scoped(NO_FILTERS, 'active'))).toEqual(['DRAW', 'LIVE', 'LOGIN', 'ORDER', 'SCAN', 'VIEW']);
    expect(keysOf(await scoped(NO_FILTERS, 'new'))).toEqual(['IDLE']);
    expect(keysOf(await scoped(f({ c: 'FR' }), 'active'))).toEqual(['DRAW', 'LIVE', 'LOGIN', 'ORDER', 'SCAN', 'VIEW']);
  });

  it('ageBandSql gives ageBand’s band for every date of birth of 1958 to 2012, on 28 February and 1 March of a common year, and on 29 February', async () => {
    for (const today of ['2026-02-28', '2026-03-01', '2028-02-29', '2026-10-14']) {
      const births: string[] = [];
      for (let d = '1958-01-01'; d <= '2012-12-31'; d = plusDays(d, 7)) births.push(d);
      births.push('2008-02-29', '2004-02-29', '1961-10-14', '1961-10-15', '2008-10-14', '2008-10-15', '2010-02-28', '2010-03-01');
      const rows = await sql<{ b: string; band: string }>`
        SELECT v.b, ${ageBandSql(sql`v.b::date`, today)} AS band FROM (VALUES ${sql.join(births.map((b) => sql`(${b})`))}) AS v(b)`.execute(h.t.db);
      for (const r of rows.rows) expect(r.band, `${r.b} on ${today}`).toBe(bandOfAge(ageOn(r.b, today)));
      const none = await sql<{ band: string }>`SELECT ${ageBandSql(sql`NULL::date`, today)} AS band`.execute(h.t.db);
      expect(none.rows[0]!.band).toBe('none');
    }
  });

  it('a name for the CTE that is not a plain identifier is refused', () => {
    expect(() => scopeCte('col; DROP', { filters: NO_FILTERS, scope: 'all' }, { start: START, end: END })).toThrow(TypeError);
  });
});
