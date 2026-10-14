/**
 * The Collectors page's readings (plan CUSTOMER INTELLIGENCE §3.6 C.6, C.13 « collector-insights.test.ts »; steps 9.2
 * and on; services/collector-insights.ts), on a seeded house of 200 collectors, 20 test entrants, 2 team accounts and 5
 * DELETED accounts, every figure counted again here from the seed's own description (`HOUSE`), never from the SQL:
 *
 *  - overview (step 9.2): the six KPIs for LAST 30 DAYS with the previous period, each scope, filters alone and combined
 *    (the first visits from the Links reports' rule without a filter narrowing the collectors, from the collectors'
 *    devices with one), the median score withheld under 3;
 *  - who (step 9.2): AGES with the median age, COUNTRIES and CITIES as given (grouped ignoring case and accents, shown as
 *    most often typed) and from the connection (the usual place), the comparison by NEW with ALL and by SCOPE otherwise;
 *  - the cache (a second read does not read; Read again under 30 s does not either, after it does; 5 minutes; 50 kept),
 *    the load guard (a third reading waits, then 503 INSIGHTS_BUSY), the timeout (PostgreSQL's 57014 mapped to 503
 *    INSIGHTS_TIMEOUT, logged with the panel and the period only), and each reading's transaction (REPEATABLE READ,
 *    READ ONLY, work_mem 32MB, statement_timeout 8s).
 *
 * Test entrants, the team's accounts and DELETED accounts carry countries, profiles, places, scores, wishes, sign-ins
 * and devices too: none of it may reach a figure.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/server/db/connection.js';
import { ageBand as bandOfAge, ageOn } from '../../src/shared/profile-rules.js';
import { fold } from '../../src/shared/fold.js';
import {
  CollectorInsightsService,
  INSIGHTS_CACHE_SIZE,
  type BarRow,
  type CollectorsReport,
  type InsightsRequest,
  type LinkChannelRows,
  type OriginFigures,
  type OverviewFigures,
  type WhoFigures,
} from '../../src/server/services/collector-insights.js';
import { median } from '../../src/server/services/growth.js';
import { AGE_SLICES, parisPeriod, previousPeriod, type Period } from '../../src/server/services/insights-scope.js';
import { parisDay, parisDayStart } from '../../src/server/services/schedule.js';
import { createManualClock, type Logger } from '../../src/server/types.js';
import { GrowthWorld } from '../support/growth.js';
import { seedScore } from '../support/scores.js';
import { createAdmin, createHarness, type Harness } from '../api/support.js';

const NOW = new Date('2026-10-14T10:00:00.000Z'); // 12:00 Paris
const TODAY = '2026-10-14';
const day = (d: string, n: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10);
const atParis = (d: string, hours: number) => new Date(parisDayStart(d).getTime() + hours * 3_600_000);
const within = (at: Date | null, p: Period) => at !== null && at >= p.start && at < p.end;

/** One seeded account, as the test reads it back. */
interface Seed {
  key: string;
  kind: 'COLLECTOR' | 'TEST' | 'TEAM' | 'DELETED' | 'LOCKED';
  created: Date;
  country: string | null;
  birth: string | null;
  city: string | null;
  /** The usual place from the connection: [country, city | null] or none. */
  place: [string, string | null] | null;
  score: number | null;
  wishAt: Date | null;
  loginAt: Date | null;
  firstSeenAt: Date | null;
  id?: string;
}

const COUNTRIES = ['FR', 'IT', 'GB', null] as const;
const CITIES = ['Lyon', 'lyon', 'LYON', 'Paris', 'Saint-Étienne', 'saint-etienne', 'Milano', null] as const;
const BIRTHS = ['2009-03-01', '2008-10-14', '2008-10-15', '2001-10-14', '1990-05-20', '1984-02-29', '1975-12-31', '1966-01-01', '1961-10-14', null] as const;
const PLACES: ([string, string | null] | null)[] = [['FR', 'Paris'], ['FR', 'Lyon'], ['IT', 'Milan'], ['GB', null], null];

/** The house (see the file header): 200 counted collectors (LOCKED ones among them), then those never counted. */
function house(): Seed[] {
  const out: Seed[] = [];
  const one = (i: number, kind: Seed['kind']): Seed => {
    const created = atParis(day(TODAY, -(i % 120)), 1 + (i % 20));
    return {
      key: `${kind}-${i}`,
      kind,
      created,
      country: COUNTRIES[i % 4]!,
      birth: i % 5 === 0 ? null : BIRTHS[i % 10]!,
      city: i % 5 === 0 ? null : CITIES[i % 8]!,
      place: PLACES[i % 5]!,
      score: i % 2 === 0 ? (i * 7) % 101 : null,
      wishAt: i % 7 === 0 ? new Date(created.getTime() + 86_400_000) : null,
      loginAt: i % 4 === 0 ? new Date(created.getTime() + 2 * 86_400_000) : null,
      firstSeenAt: i % 10 === 0 ? new Date(created.getTime() - 3_600_000) : null,
    };
  };
  for (let i = 0; i < 200; i++) out.push(one(i, i % 25 === 3 ? 'LOCKED' : 'COLLECTOR'));
  for (let i = 0; i < 20; i++) out.push(one(i, 'TEST'));
  for (let i = 0; i < 2; i++) out.push(one(i, 'TEAM'));
  for (let i = 0; i < 5; i++) out.push(one(i, 'DELETED'));
  return out;
}

const HOUSE = house();
const COUNTED = HOUSE.filter((s) => s.kind === 'COLLECTOR' || s.kind === 'LOCKED');

describe('CollectorInsightsService (§3.6 C.6, steps 9.2 and on)', () => {
  let h: Harness;
  let svc: CollectorInsightsService;
  const P30 = parisPeriod({ p: '30d' }, NOW);
  const B30 = previousPeriod(P30);
  const devices: { at: Date; linkedTo: Seed | null }[] = [];

  async function seed(db: Db): Promise<void> {
    const team = [await createAdmin(h.ctx, 'AUDITOR'), await createAdmin(h.ctx, 'OPERATOR')];
    let t = 0;
    const places = new Map<string, number>();
    for (const [country, city] of PLACES.filter((p): p is [string, string | null] => p !== null)) {
      places.set(`${country}/${city}`, (await db.insertInto('geo_places').values({ country, city }).returning('id').executeTakeFirstOrThrow()).id);
    }
    const direct = (await db.selectFrom('acquisition_sources').select('id').where('key', '=', 'DIRECT').executeTakeFirstOrThrow()).id;
    for (const s of HOUSE) {
      const email = s.kind === 'TEAM' ? team[t++]!.email : `ci-${s.key.toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`;
      s.id = (
        await db
          .insertInto('accounts')
          .values({
            email,
            email_normalized: email.toLowerCase(),
            password_hash: 'x',
            country: s.country,
            status: s.kind === 'DELETED' ? 'DELETED' : s.kind === 'LOCKED' ? 'LOCKED' : 'ACTIVE',
            created_at: s.created,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      if (s.kind === 'TEST') await db.insertInto('test_entrants').values({ account_id: s.id }).execute();
      if (s.birth || s.city) {
        await db
          .insertInto('account_profiles')
          .values({
            account_id: s.id,
            birth_date: s.birth,
            birth_date_by: s.birth ? 'COLLECTOR' : null,
            birth_date_at: s.birth ? s.created : null,
            city: s.city,
          })
          .execute();
      }
      if (s.place) {
        // The usual place has the most days; a second place with fewer days never wins.
        await db
          .insertInto('collector_places')
          .values({
            account_id: s.id,
            place_id: places.get(`${s.place[0]}/${s.place[1]}`)!,
            days: 5,
            first_day: '2026-06-01',
            last_day: '2026-10-01',
          })
          .execute();
        const other = s.place[0] === 'IT' ? 'FR/Paris' : 'IT/Milan';
        await db
          .insertInto('collector_places')
          .values({
            account_id: s.id,
            place_id: places.get(other)!,
            days: 2,
            first_day: '2026-06-01',
            last_day: '2026-10-02',
          })
          .execute();
      }
      if (s.score !== null) await seedScore(db, s.id, s.score, NOW);
      if (s.firstSeenAt)
        await db
          .insertInto('account_sources')
          .values({
            account_id: s.id,
            first_source_id: direct,
            first_seen_at: s.firstSeenAt,
            set_at: s.created,
            set_by: 'SIGN_UP',
          })
          .execute();
    }
    // Wishes, on one model.
    const model = await (await new GrowthWorld(db).prepare()).model('MONOLITHE', { price: [48_000, 'EUR'] });
    for (const s of HOUSE) if (s.wishAt) await db.insertInto('account_wishes').values({ account_id: s.id!, model_id: model, added_at: s.wishAt }).execute();
    // Sign-ins, at their instants (the audit log takes the clock's time), oldest first.
    for (const s of [...HOUSE].filter((x) => x.loginAt).sort((a, b) => a.loginAt!.getTime() - b.loginAt!.getTime())) {
      h.clock.set(s.loginAt!);
      await h.ctx.audit.record({
        actor: { type: 'account', id: s.id! },
        action: 'account.login',
        targetType: 'account',
        targetId: s.id!,
      });
    }
    // Devices: 12 first seen in the period, 5 in the previous one, from a direct arrival; the first four of each linked
    // to a collector of FR, the fifth to a test entrant; a console's device in the period with no source.
    const fr = COUNTED.filter((s) => s.country === 'FR');
    const testEntrant = HOUSE.find((s) => s.kind === 'TEST')!;
    const addDevice = async (at: Date, n: number, linkedTo: Seed | null, staff = false) => {
      const id = (
        await db
          .insertInto('tracking_devices')
          .values({
            device_hash: `ci${String(n).padStart(6, '0')}${'x'.repeat(35)}`,
            first_seen_at: at,
            last_seen_at: at,
            first_source_id: staff ? null : direct,
            staff_at: staff ? at : null,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      if (linkedTo)
        await db
          .insertInto('tracking_device_accounts')
          .values({
            device_id: id,
            account_id: linkedTo.id!,
            first_via: 'SIGN_UP',
            first_linked_at: at,
            last_linked_at: at,
          })
          .execute();
      if (!staff) devices.push({ at, linkedTo });
    };
    let n = 0;
    for (let i = 0; i < 12; i++) await addDevice(atParis(day(TODAY, -i * 2), 9), ++n, i < 4 ? fr[i]! : i === 4 ? testEntrant : null);
    for (let i = 0; i < 5; i++) await addDevice(atParis(day(B30.from, i * 3), 9), ++n, i < 4 ? fr[10 + i]! : null);
    await addDevice(atParis(TODAY, 8), ++n, fr[0]!, true);
    await db
      .updateTable('acquisition_state')
      .set({
        tracking_started_at: new Date('2026-06-01T00:00:00Z'),
        conversions_until: new Date('2026-06-01T00:00:00Z'),
      })
      .execute();
  }

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-06-01T00:00:00Z');
    await seed(h.t.db);
    h.clock.set(NOW);
    svc = h.ctx.services.collectorInsights;
  }, 120_000);
  afterAll(() => h?.close());

  const report = async (req: Omit<InsightsRequest, 'panel'> & { panel: 'overview' | 'who' }): Promise<CollectorsReport> => {
    svc.clearCache();
    return svc.report(req);
  };
  const overview = async (req: Omit<InsightsRequest, 'panel'> = {}) => (await report({ panel: 'overview', ...req })).figures as OverviewFigures;
  const who = async (req: Omit<InsightsRequest, 'panel'> = {}) => (await report({ panel: 'who', ...req })).figures as WhoFigures;

  // ── The counts by hand ───────────────────────────────────────────────────────────────────────────────────────
  type Pick = (s: Seed) => boolean;
  const activeIn = (s: Seed, p: Period) => within(s.loginAt, p);
  const inScope = (scope: 'all' | 'active' | 'new', p: Period, f: Pick = () => true) => COUNTED.filter((s) => f(s) && (scope === 'all' || (scope === 'new' ? within(s.created, p) : activeIn(s, p))));
  const scoreMedian = (list: Seed[]) => {
    const v = list.filter((s) => s.score !== null).map((s) => s.score!);
    return v.length >= 3 ? median(v) : null;
  };
  const visits = (p: Period, f?: Pick) => devices.filter((d) => within(d.at, p) && (!f || (d.linkedTo !== null && d.linkedTo.kind !== 'TEST' && f(d.linkedTo)))).length;
  const handOverview = (scope: 'all' | 'active' | 'new', f: Pick = () => true, narrowed = false): OverviewFigures => {
    const now = inScope(scope, P30, f);
    const before = inScope(scope, B30, f);
    return {
      collectors: {
        value: now.length,
        previous: scope === 'all' ? before.filter((s) => s.created < B30.end).length : before.length,
      },
      newCollectors: {
        value: now.filter((s) => within(s.created, P30)).length,
        previous: before.filter((s) => within(s.created, B30)).length,
      },
      firstVisits: {
        value: narrowed || scope !== 'all' ? visits(P30, (s) => inScope(scope, P30, f).includes(s)) : visits(P30),
        previous: narrowed || scope !== 'all' ? visits(B30, (s) => inScope(scope, B30, f).includes(s)) : visits(B30),
        becameCollectors: now.filter((s) => within(s.firstSeenAt, P30)).length,
      },
      active: {
        value: now.filter((s) => activeIn(s, P30)).length,
        previous: before.filter((s) => activeIn(s, B30)).length,
      },
      medianScore: {
        value: scoreMedian(now),
        previous: null,
        scored: now.filter((s) => s.score !== null).length,
        scoresOn: null,
      },
      wishesAdded: {
        value: now.filter((s) => within(s.wishAt, P30)).length,
        previous: before.filter((s) => within(s.wishAt, B30)).length,
        collectors: now.filter((s) => within(s.wishAt, P30)).length,
        previousCollectors: before.filter((s) => within(s.wishAt, B30)).length,
      },
    };
  };

  describe('overview (At a glance)', () => {
    it('the six KPIs of LAST 30 DAYS and the previous period, counted collectors only', async () => {
      const r = await report({ panel: 'overview' });
      expect(r).toMatchObject({
        panel: 'overview',
        period: { key: '30d', from: '2026-09-15', to: '2026-10-14', days: 30 },
        previous: { from: '2026-08-16', to: '2026-09-14' },
        scope: 'all',
        compareBy: 'NEW',
      });
      expect(r.readAt).toEqual(NOW);
      const f = r.figures as OverviewFigures;
      expect(f).toEqual(handOverview('all'));
      // The hand counts are not empty: the house has collectors of every kind in both periods.
      expect(f.collectors.value).toBe(200);
      expect(f.newCollectors.value).toBeGreaterThan(30);
      expect(f.active.value).toBeGreaterThan(5);
      expect(f.firstVisits.value).toBe(12);
      expect(f.firstVisits.previous).toBe(5);
      expect(f.wishesAdded.value).toBeGreaterThan(3);
    });

    it('without the comparison, no previous value; the scopes ACTIVE and NEW compare with the previous period’s', async () => {
      const off = await overview({ cmp: false });
      expect(off.collectors).toEqual({ value: 200, previous: null });
      expect(off.firstVisits.previous).toBeNull();
      expect((await report({ panel: 'overview', cmp: false })).compareBy).toBeNull();
      for (const scope of ['active', 'new'] as const) {
        const r = await report({ panel: 'overview', scope });
        expect(r.compareBy).toBe('SCOPE');
        expect(r.figures, scope).toEqual(handOverview(scope));
      }
    });

    it('each filter alone and combined; the first visits follow the collectors once a filter narrows them', async () => {
      expect(await overview({ c: 'FR' })).toEqual(handOverview('all', (s) => s.country === 'FR', true));
      expect(await overview({ c: 'IT,GB' })).toEqual(handOverview('all', (s) => s.country === 'IT' || s.country === 'GB', true));
      expect(await overview({ sc: '40-100' })).toEqual(handOverview('all', (s) => s.score !== null && s.score >= 40, true));
      expect(await overview({ c: 'FR', sc: '0-50', scope: 'new' })).toEqual(handOverview('new', (s) => s.country === 'FR' && s.score !== null && s.score <= 50, true));
      expect(await overview({ t: '0' })).toEqual(handOverview('all', () => true, true));
      expect((await overview({ t: '3' })).collectors.value).toBe(0);
      // The source alone keeps the Links reports' rule: every device first seen, from a direct arrival here.
      expect(await overview({ s: 'kind:DIRECT' })).toMatchObject({
        firstVisits: { value: 12, previous: 5 },
      });
      expect((await overview({ s: 'kind:DIRECT' })).collectors.value).toBe(COUNTED.filter((s) => s.firstSeenAt !== null || s.created >= new Date('2026-06-01T00:00:00Z')).length);
      expect(await overview({ s: 'kind:SITE' })).toMatchObject({
        collectors: { value: 0 },
        firstVisits: { value: 0, previous: 0 },
      });
    });

    it('the median score is withheld under 3 scored collectors; the latest finished run names the scores’ day', async () => {
      const few = await overview({ sc: '100-100' });
      expect(few.medianScore.scored).toBe(COUNTED.filter((s) => s.score === 100).length);
      expect(few.medianScore.scored).toBeLessThan(3);
      expect(few.medianScore.value).toBeNull();
      await h.t.db
        .insertInto('engagement_runs')
        .values({
          day: '2026-10-13',
          formula: 1,
          started_at: NOW,
          finished_at: NOW,
          accounts: 1,
          changed: 1,
          bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
          duration_ms: 5,
        })
        .execute();
      await h.t.db.insertInto('engagement_runs').values({ day: '2026-10-14', formula: 1, started_at: NOW }).execute();
      expect((await overview()).medianScore.scoresOn).toBe('2026-10-13');
      await h.t.db.deleteFrom('engagement_runs').execute();
    });
  });

  describe('who (Who they are)', () => {
    const handBars = (scope: 'all' | 'active' | 'new', keyOf: (s: Seed) => string, f: Pick = () => true): Map<string, { n: number; now: number; before: number }> => {
      const out = new Map<string, { n: number; now: number; before: number }>();
      const get = (k: string) => out.get(k) ?? (out.set(k, { n: 0, now: 0, before: 0 }), out.get(k)!);
      for (const s of inScope(scope, P30, f)) {
        const e = get(keyOf(s));
        e.n += 1;
        if (scope === 'all') {
          if (within(s.created, P30)) e.now += 1;
          if (within(s.created, B30)) e.before += 1;
        } else e.now += 1;
      }
      if (scope !== 'all') for (const s of inScope(scope, B30, f)) get(keyOf(s)).before += 1;
      return out;
    };
    const asMap = (rows: BarRow[]) => new Map(rows.map((r) => [r.key, { n: r.collectors, now: r.compare!.now, before: r.compare!.before }]));
    const ageKey = (s: Seed) => (s.birth ? bandOfAge(ageOn(s.birth, TODAY)) : 'none');

    it('AGES in the page’s order, Not given last, with the median age; COUNTRIES as given and from the connection', async () => {
      const f = await who();
      expect(f.total).toBe(200);
      expect(f.ages.rows.map((r) => r.key)).toEqual([...AGE_SLICES]);
      const ages = handBars('all', ageKey);
      for (const r of f.ages.rows)
        expect({ key: r.key, n: r.collectors, ...r.compare }).toEqual({
          key: r.key,
          n: ages.get(r.key)?.n ?? 0,
          now: ages.get(r.key)?.now ?? 0,
          before: ages.get(r.key)?.before ?? 0,
        });
      expect(f.ages.rows.reduce((a, r) => a + r.collectors, 0)).toBe(200);
      expect(f.ages.median).toBe(median(COUNTED.filter((s) => s.birth).map((s) => ageOn(s.birth!, TODAY))));
      expect(asMap(f.countries.given)).toEqual(handBars('all', (s) => s.country ?? 'none'));
      expect(f.countries.given[f.countries.given.length - 1]!.key).toBe('none');
      expect(asMap(f.countries.connection)).toEqual(handBars('all', (s) => s.place?.[0] ?? 'unknown'));
      expect(f.countries.connection.map((r) => r.key)).toEqual(['FR', 'GB', 'IT', 'unknown']);
    });

    it('CITIES as given: one group whatever the case and accents, shown as most often typed; from the connection: by place', async () => {
      const f = await who();
      const groups = new Map<string, number>();
      for (const s of COUNTED) if (s.city) groups.set(fold(s.city), (groups.get(fold(s.city)) ?? 0) + 1);
      expect(f.cities.given.groups).toBe(groups.size);
      expect(f.cities.given.rows.filter((r) => r.key !== 'none').map((r) => [r.key, r.collectors])).toEqual([...groups].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
      const lyon = f.cities.given.rows.find((r) => r.key === 'lyon')!;
      const typed = (form: string) => COUNTED.filter((s) => s.city === form).length;
      expect(lyon.label).toBe(['Lyon', 'lyon', 'LYON'].sort((a, b) => typed(b) - typed(a) || (a < b ? -1 : 1))[0]);
      expect(f.cities.given.rows.find((r) => r.key === 'saint-etienne')!.collectors).toBe(typed('Saint-Étienne') + typed('saint-etienne'));
      expect(f.cities.given.rows[f.cities.given.rows.length - 1]).toMatchObject({ key: 'none', collectors: COUNTED.filter((s) => !s.city).length });
      const conn = f.cities.connection.rows.filter((r) => r.key !== 'unknown');
      expect(conn.map((r) => [r.country, r.label, r.collectors])).toEqual(
        [
          ['FR', 'Paris', COUNTED.filter((s) => s.place?.[1] === 'Paris').length],
          ['FR', 'Lyon', COUNTED.filter((s) => s.place?.[1] === 'Lyon').length],
          ['IT', 'Milan', COUNTED.filter((s) => s.place?.[1] === 'Milan').length],
        ].sort((a, b) => (b[2] as number) - (a[2] as number) || 0),
      );
      expect(f.cities.connection.groups).toBe(3);
      // GB's place has no city: counted as Unknown, last, with those without a place.
      const unknown = COUNTED.filter((s) => !s.place || s.place[1] === null).length;
      expect(f.cities.connection.rows[f.cities.connection.rows.length - 1]).toMatchObject({ key: 'unknown', label: null, collectors: unknown });
      expect(unknown).toBeGreaterThan(0);
    });

    it('with the scope NEW, every bar compares with the previous period’s new collectors; filters narrow every tab', async () => {
      const r = await report({ panel: 'who', scope: 'new', c: 'FR,IT' });
      expect(r.compareBy).toBe('SCOPE');
      const f = r.figures as WhoFigures;
      const pick: Pick = (s) => s.country === 'FR' || s.country === 'IT';
      expect(f.total).toBe(inScope('new', P30, pick).length);
      expect(asMap(f.ages.rows.filter((x) => x.collectors + x.compare!.before > 0))).toEqual(handBars('new', ageKey, pick));
      expect(asMap(f.countries.given)).toEqual(handBars('new', (s) => s.country ?? 'none', pick));
      const off = await who({ cmp: false, scope: 'active' });
      expect(off.ages.rows.every((x) => x.compare === null)).toBe(true);
      expect(off.total).toBe(inScope('active', P30).length);
    });
  });

  describe('the cache, the load guard and the timeout', () => {
    const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {} };
    const make = (
      o: {
        db?: Db;
        reader?: (tx: Db) => Promise<unknown>;
        concurrent?: number;
        waitMs?: number;
        log?: Logger;
        clock?: ReturnType<typeof createManualClock>;
      } = {},
    ) => {
      const clock = o.clock ?? createManualClock(NOW);
      let reads = 0;
      const reader = async (tx: Db) => {
        reads += 1;
        return o.reader ? o.reader(tx) : { n: reads };
      };
      const service = new CollectorInsightsService({
        db: o.db ?? h.t.db,
        links: h.ctx.services.links,
        clock: clock.now,
        log: o.log ?? quiet,
        limits: { concurrent: o.concurrent, waitMs: o.waitMs },
        panels: { overview: reader, who: reader },
      });
      return { service, clock, reads: () => reads };
    };

    it('a second read of the same view does not read; Read again under 30 s does not either, after 30 s it does; 5 minutes kept', async () => {
      const { service, clock, reads } = make();
      const a = await service.report({ panel: 'overview' });
      const b = await service.report({ panel: 'overview', c: 'fr', cmp: true });
      expect(reads()).toBe(2); // c=fr is another view
      expect(await service.report({ panel: 'overview' })).toBe(a);
      expect(await service.report({ panel: 'overview', c: 'FR' })).toBe(b);
      expect(reads()).toBe(2);
      clock.advance(29_000);
      expect(await service.report({ panel: 'overview', fresh: true })).toBe(a);
      expect(reads()).toBe(2);
      clock.advance(1_000);
      const c = await service.report({ panel: 'overview', fresh: true });
      expect(reads()).toBe(3);
      expect(c.readAt.getTime()).toBe(NOW.getTime() + 30_000);
      expect(await service.report({ panel: 'overview' })).toBe(c);
      clock.advance(5 * 60_000);
      await service.report({ panel: 'overview' });
      expect(reads()).toBe(4);
    });

    it('keeps the last 50 results, the least recently read first out', async () => {
      const { service, reads } = make();
      const views = Array.from({ length: INSIGHTS_CACHE_SIZE + 1 }, (_, i) => ({
        panel: 'overview',
        sc: `0-${i}`,
      }));
      for (const v of views) await service.report(v);
      expect(reads()).toBe(51);
      await service.report(views[50]!);
      expect(reads()).toBe(51);
      await service.report(views[0]!); // the first one was evicted
      expect(reads()).toBe(52);
      await service.report(views[2]!);
      expect(reads()).toBe(52);
    });

    it('two readings at once; a third waits for a turn, then answers 503 INSIGHTS_BUSY', async () => {
      // Inside one transaction (PGlite has one connection: two transactions could not be open at once here).
      await h.t.db.transaction().execute(async (trx) => {
        const releases: (() => void)[] = [];
        const { service, reads } = make({
          db: trx,
          concurrent: 2,
          waitMs: 80,
          reader: () => new Promise((resolve) => releases.push(() => resolve({ ok: true }))),
        });
        const first = service.report({ panel: 'overview', sc: '0-1' });
        const second = service.report({ panel: 'overview', sc: '0-2' });
        const third = service.report({ panel: 'overview', sc: '0-3' });
        await expect(third).rejects.toMatchObject({
          code: 'INSIGHTS_BUSY',
          httpStatus: 503,
          publicMessage: 'The figures are being read for someone else. Try again in a moment.',
        });
        expect(reads()).toBe(2);
        // A fourth waits, and reads once a turn is given back.
        const fourth = service.report({ panel: 'overview', sc: '0-4' });
        releases.shift()!();
        await first;
        await new Promise((r) => setTimeout(r, 10));
        expect(reads()).toBe(3);
        releases.shift()!();
        releases.shift()!();
        await Promise.all([second, fourth]);
      });
    });

    it('a reading cut by statement_timeout answers 503 INSIGHTS_TIMEOUT, logged with the panel and the period only', async () => {
      const warned: unknown[] = [];
      const log: Logger = {
        ...quiet,
        warn: (obj: unknown) => void warned.push(obj),
      } as Logger;
      const { service } = make({
        log,
        reader: async () => Promise.reject(Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })),
      });
      await expect(service.report({ panel: 'who', c: 'FR', ft: 'RING' })).rejects.toMatchObject({
        code: 'INSIGHTS_TIMEOUT',
        httpStatus: 503,
        publicMessage: 'These figures took too long to read. Choose a shorter period or fewer filters, then try again.',
      });
      expect(warned).toEqual([{ panel: 'who', from: '2026-09-15', to: '2026-10-14', scope: 'all' }]);
      expect(JSON.stringify(warned)).not.toMatch(/FR|RING/);
      // Another error passes as it is, and is not cached.
      const other = make({
        reader: async () => Promise.reject(new Error('boom')),
      });
      await expect(other.service.report({ panel: 'who' })).rejects.toThrow('boom');
    });

    it('each reading runs in one REPEATABLE READ, READ ONLY transaction with work_mem 32MB and statement_timeout 8s', async () => {
      const { service } = make({
        reader: async (tx) => {
          const r = await sql<{
            iso: string;
            ro: string;
            mem: string;
            timeout: string;
          }>`
            SELECT current_setting('transaction_isolation') AS iso, current_setting('transaction_read_only') AS ro,
                   current_setting('work_mem') AS mem, current_setting('statement_timeout') AS timeout`.execute(tx);
          return r.rows[0];
        },
      });
      const r = await service.report({ panel: 'who' });
      expect(r.figures).toEqual({
        iso: 'repeatable read',
        ro: 'on',
        mem: '32MB',
        timeout: '8s',
      });
    });

    it('refuses another panel, scope, currency, period or filter (400 VALIDATION_FAILED), before any reading', async () => {
      const { service, reads } = make();
      for (const req of [
        { panel: 'likes' },
        { panel: 'overview', scope: 'some' },
        { panel: 'overview', currency: 'JPY' },
        {
          panel: 'overview',
          p: 'custom',
          from: '2025-01-01',
          to: '2025-02-01',
        },
        { panel: 'overview', t: '9' },
      ]) {
        await expect(service.report(req), JSON.stringify(req)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      }
      expect(reads()).toBe(0);
    });
  });

  it('options: the countries of the counted collectors, the channels, the kinds, the tiers, the types, the currencies, the recording’s start', async () => {
    const o = await svc.options();
    expect(o.countries).toEqual(['FR', 'GB', 'IT']);
    expect(o.channels.map((c) => c.name)).toEqual((await h.ctx.services.links.channels()).map((c) => c.name));
    expect(o.sourceKinds).toEqual(['CAMPAIGN', 'SITE', 'DIRECT', 'BEFORE', 'STAFF']);
    expect(o.tiers).toEqual([0, 1, 2, 3]);
    expect(o.types).toEqual([]);
    expect(o).toMatchObject({
      currency: 'EUR',
      currencies: ['EUR'],
      snapshotsSince: null,
    });
    expect(o.recordingSince).toBeInstanceOf(Date);
    expect(parisDay(NOW)).toBe(TODAY);
  });
});

/**
 * Where they come from (step 9.3), on a scripted autumn written through the acquisition's own services (the arrivals,
 * the links at sign-up, the conversions job), as test/services/acquisition-report.test.ts writes its story; the
 * recording starts on 1 September 2026, the period is October (CUSTOM), the previous one September:
 *
 *   A     through L1 « Instagram bio » (2 Oct), then L2 « Léa — TikTok » (5 Oct), signs up 6 Oct, a salon order of € 300
 *         paid 10 Oct (its last link L2), heard through the first answer;
 *   B, C  through L1 (3 Oct, 4 Oct), sign up the same day, salon orders of € 200 and € 100 (12 Oct, 14 Oct; last L1);
 *         B answered Other, C an answer set aside since;
 *   D     through L1 (5 Oct), signs up, buys nothing;
 *   E, E2 campaign tags ig / story / drop-14, content story-1 and story-2 (7 Oct, 8 Oct), sign up; E buys for £ 50;
 *   F     from vogue.fr (9 Oct), signs up; G arrives direct (11 Oct) and signs up;
 *   SEPT  through L1 on 15 Sep, signs up that day; OLD made on 20 Aug, before the recording: Before tracking;
 *   two anonymous first visits in October (one through the archived L3, one through the campaign);
 *   T a test entrant, H one of the team's own accounts and X a DELETED account, each through L1 with an order: in no
 *   figure (their devices are first visits, the Links reports' rule counting every device).
 * L2 is archived after A's visit: it stays in LINKS, marked, since it has a figure.
 */
describe('CollectorInsightsService, origin (§3.6 C.6.3 item 3, §3.4 A.10.6; step 9.3)', () => {
  let h: Harness;
  let svc: CollectorInsightsService;
  let w: GrowthWorld;
  let model = '';
  const acc: Record<string, string> = {};
  const link: Record<string, string> = {};
  const channel: Record<string, string> = {};
  const heard: { id: string; label: string; is_other: boolean }[] = [];
  let seq = 0;
  const z = (iso: string) => new Date(iso);
  const OCT = { p: 'custom', from: '2026-10-01', to: '2026-10-31' } as const;

  const device = async (key: string, first: Date) => {
    const hash = `o${key.padEnd(7, '_')}${String(++seq).padStart(4, '0')}${'q'.repeat(31)}`;
    const id = (await h.t.db.insertInto('tracking_devices').values({ device_hash: hash, first_seen_at: first, last_seen_at: first }).returning('id').executeTakeFirstOrThrow()).id;
    return { id, hash };
  };
  const arrive = (d: { id: number }, at: string, a: { link?: string; utm?: Record<string, string>; referrer?: string }) =>
    h.ctx.services.acquisition.arrive({ deviceId: d.id, accountId: null, now: z(at), ...a });
  const signUp = async (key: string, d: { hash: string } | null, at: string, email = `origin-${key.toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`) => {
    acc[key] = (await h.t.db.insertInto('accounts').values({ email, email_normalized: email, password_hash: 'x', country: 'FR', created_at: z(at) }).returning('id').executeTakeFirstOrThrow()).id;
    if (d) await h.ctx.services.tracking.link(d.hash, acc[key]!, 'SIGN_UP', z(at));
  };
  const code = async (key: string) => (await h.t.db.selectFrom('links').select('code').where('id', '=', link[key]!).executeTakeFirstOrThrow()).code;
  const journey = async (key: string, first: string, a: { link?: string; utm?: Record<string, string>; referrer?: string }, signUpAt = first) => {
    const d = await device(key, z(first));
    await arrive(d, first, a);
    await signUp(key, d, signUpAt);
    return d;
  };

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-09-01T08:00:00Z');
    await h.t.db.updateTable('acquisition_state').set({ tracking_started_at: z('2026-09-01T08:00:00Z'), conversions_until: z('2026-09-01T08:00:00Z') }).execute();
    w = await new GrowthWorld(h.t.db).prepare();
    model = await w.model('MONOLITHE', { price: [30_000, 'EUR'] });
    const admin = await createAdmin(h.ctx, 'OPERATOR');
    const actor = { type: 'admin' as const, id: admin.id };
    for (const c of await h.ctx.services.links.channels()) channel[c.name] = c.id;
    for (const [key, name, ch, cost] of [
      ['L1', 'Instagram bio', 'Instagram', { minor: 10_000, currency: 'EUR' as const }],
      ['L2', 'Léa — TikTok', 'Influencers', null],
      ['L3', 'Old post', 'Instagram', null],
    ] as const) {
      h.clock.advance(60_000);
      link[key] = (await h.ctx.services.links.create({ name, channelId: channel[ch], destination: 'NOW', ...(cost ? { cost } : {}) }, actor)).id;
    }
    await h.ctx.services.links.archive(link.L3!, actor);
    const [L1, L2, L3] = [await code('L1'), await code('L2'), await code('L3')];

    await signUp('OLD', null, '2026-08-20T10:00:00Z');
    await journey('SEPT', '2026-09-15T10:00:00Z', { link: L1 });
    const dA = await device('A', z('2026-10-02T10:00:00Z'));
    await arrive(dA, '2026-10-02T10:00:00Z', { link: L1 });
    await arrive(dA, '2026-10-05T10:00:00Z', { link: L2 });
    await signUp('A', dA, '2026-10-06T10:00:00Z');
    await h.ctx.services.links.archive(link.L2!, actor);
    await journey('B', '2026-10-03T09:00:00Z', { link: L1 }, '2026-10-03T10:00:00Z');
    await journey('C', '2026-10-04T09:00:00Z', { link: L1 }, '2026-10-04T10:00:00Z');
    await journey('D', '2026-10-05T09:00:00Z', { link: L1 }, '2026-10-05T10:00:00Z');
    await journey('E', '2026-10-07T09:00:00Z', { utm: { source: 'ig', medium: 'story', campaign: 'drop-14', content: 'story-1' } }, '2026-10-07T10:00:00Z');
    await journey('E2', '2026-10-08T09:00:00Z', { utm: { source: 'ig', medium: 'story', campaign: 'drop-14', content: 'story-2' } }, '2026-10-08T10:00:00Z');
    await journey('F', '2026-10-09T09:00:00Z', { referrer: 'https://www.vogue.fr/article' }, '2026-10-09T10:00:00Z');
    await journey('G', '2026-10-11T09:00:00Z', {}, '2026-10-11T10:00:00Z');
    await arrive(await device('Y', z('2026-10-03T12:00:00Z')), '2026-10-03T12:00:00Z', { link: L3 });
    await arrive(await device('Z', z('2026-10-07T12:00:00Z')), '2026-10-07T12:00:00Z', { utm: { source: 'ig', medium: 'story', campaign: 'drop-14', content: 'story-1' } });
    const team = await createAdmin(h.ctx, 'AUDITOR');
    await journey('T', '2026-10-06T09:00:00Z', { link: L1 }, '2026-10-06T10:00:00Z');
    await h.t.db.insertInto('test_entrants').values({ account_id: acc.T! }).execute();
    const dH = await device('H', z('2026-10-06T09:00:00Z'));
    await arrive(dH, '2026-10-06T09:00:00Z', { link: L1 });
    await signUp('H', dH, '2026-10-06T10:00:00Z', team.email);
    await journey('X', '2026-10-06T09:00:00Z', { link: L1 }, '2026-10-06T10:00:00Z');
    // Orders (paid at 12:00 UTC, reserved an hour before), then X deleted.
    for (const [key, paid, total, currency] of [['A', '2026-10-10', 30_000, 'EUR'], ['B', '2026-10-12', 20_000, 'EUR'], ['C', '2026-10-14', 10_000, 'EUR'], ['E', '2026-10-15', 5_000, 'GBP'], ['T', '2026-10-15', 9_000, 'EUR'], ['H', '2026-10-15', 9_000, 'EUR'], ['X', '2026-10-15', 9_000, 'EUR']] as const) {
      await w.order({ accountId: acc[key]!, modelId: model, channel: 'SALON', paid, total, currency });
    }
    await h.t.db.updateTable('accounts').set({ status: 'DELETED' }).where('id', '=', acc.X!).execute();
    // How they heard: A the first answer, B Other with its words, C an answer set aside since.
    heard.push(...(await h.t.db.selectFrom('heard_options').select(['id', 'label', 'is_other']).orderBy('position').execute()));
    const other = heard.find((o) => o.is_other)!;
    const aside = heard[2]!;
    for (const [key, opt, words] of [['A', heard[0]!, null], ['B', other, 'a stylist'], ['C', aside, null]] as const) {
      await h.t.db.insertInto('account_profiles').values({ account_id: acc[key]!, heard_option_id: opt.id, heard_other: words, heard_at: z('2026-10-20T10:00:00Z') }).execute();
    }
    await h.t.db.updateTable('heard_options').set({ active: false }).where('id', '=', aside.id).execute();
    await h.ctx.services.acquisition.recordConversions(z('2026-10-31T22:30:00Z'));
    h.clock.set('2026-11-02T10:00:00Z');
    svc = h.ctx.services.collectorInsights;
  }, 120_000);
  afterAll(() => h?.close());

  const origin = async (req: Omit<InsightsRequest, 'panel'> = {}) => {
    svc.clearCache();
    const r = await svc.report({ panel: 'origin', ...req });
    expect(r.panel).toBe('origin');
    return r.figures as OriginFigures;
  };
  const counted = ['A', 'B', 'C', 'D', 'E', 'E2', 'F', 'G', 'OLD', 'SEPT'];

  it('SOURCES: each channel in its order, then the kinds; the stock compared « new in October » with « new in September »', async () => {
    const f = await origin(OCT);
    expect(f.total).toBe(counted.length);
    const bar = (key: string) => f.sources.find((s) => s.key === key)!;
    expect(f.sources.map((s) => s.key)).toEqual([...(await h.ctx.services.links.channels()).map((c) => `channel:${c.id}`), 'kind:CAMPAIGN', 'kind:SITE', 'kind:DIRECT', 'kind:BEFORE']);
    expect(bar(`channel:${channel.Instagram}`)).toMatchObject({ kind: 'LINK', channel: { id: channel.Instagram, name: 'Instagram' }, collectors: 5, compare: { now: 4, before: 1 } });
    expect(bar(`channel:${channel.Influencers}`)).toMatchObject({ collectors: 0, compare: { now: 0, before: 0 } });
    expect(bar('kind:CAMPAIGN')).toMatchObject({ kind: 'CAMPAIGN', channel: null, collectors: 2, compare: { now: 2, before: 0 } });
    expect(bar('kind:SITE')).toMatchObject({ collectors: 1, compare: { now: 1, before: 0 } });
    expect(bar('kind:DIRECT')).toMatchObject({ collectors: 1, compare: { now: 1, before: 0 } });
    expect(bar('kind:BEFORE')).toMatchObject({ collectors: 1, compare: { now: 0, before: 0 } });
    expect(f.sources.reduce((a, s) => a + s.collectors, 0)).toBe(counted.length);
  });

  it('HOW THEY HEARD: the answers in the console’s order, the one set aside kept and marked, Not answered last', async () => {
    const f = await origin(OCT);
    expect(f.heard.map((b) => b.label)).toEqual([...heard.map((o) => o.label), null]);
    expect(f.heard.map((b) => b.collectors)).toEqual([...heard.map((o): number => (o.id === heard[0]!.id || o.is_other || o.id === heard[2]!.id ? 1 : 0)), 7]);
    expect(f.heard.find((b) => b.optionId === heard[2]!.id)).toMatchObject({ setAside: true, other: false });
    expect(f.heard.find((b) => b.other)).toMatchObject({ label: 'Other', collectors: 1, setAside: false });
    expect(f.heard[f.heard.length - 1]).toMatchObject({ key: 'none', optionId: null, collectors: 7 });
  });

  it('LINKS: by channel, each link as the first link and as the last link: collectors, buyers, revenue (withheld under 3 buyers), cost', async () => {
    const f = await origin({ ...OCT, currency: 'EUR' });
    expect(f.links).toMatchObject({ currency: 'EUR', currencies: ['EUR', 'GBP'] });
    expect(f.links.channels.map((c) => c.channel.name)).toEqual(['Instagram', 'Influencers']);
    const [instagram, influencers] = f.links.channels as [LinkChannelRows, LinkChannelRows];
    // L3, archived with no figure, is left out; L2, archived with one, stays, marked.
    expect(instagram.links.map((l) => l.link.name)).toEqual(['Instagram bio']);
    expect(instagram.links[0]).toMatchObject({ link: { id: link.L1, archived: false }, cost: { minor: 10_000, currency: 'EUR' }, first: { collectors: 5, buyers: 3, revenueMinor: 60_000 }, last: { collectors: 4, buyers: 2, revenueMinor: null } });
    expect(instagram).toMatchObject({ first: { collectors: 5, buyers: 3, revenueMinor: 60_000 }, last: { collectors: 4, buyers: 2, revenueMinor: null } });
    expect(influencers.links).toEqual([{ link: { id: link.L2, name: 'Léa — TikTok', code: expect.any(String), archived: true }, cost: null, first: { collectors: 0, buyers: 0, revenueMinor: null }, last: { collectors: 1, buyers: 1, revenueMinor: null } }]);
    // In pounds: the same buyers, no revenue in pounds on the link; the scope NEW of September holds SEPT alone.
    expect((await origin({ ...OCT, currency: 'GBP' })).links.channels[0]!.first).toEqual({ collectors: 5, buyers: 3, revenueMinor: 0 });
    const sept = await origin({ p: 'custom', from: '2026-09-01', to: '2026-09-30', scope: 'new' });
    expect(sept.links.channels.map((c) => [c.channel.name, c.first.collectors, c.last.collectors])).toEqual([['Instagram', 1, 1]]);
  });

  it('CAMPAIGNS: by campaign, its source and medium with their content variants summed: first visits, collectors, buyers', async () => {
    const f = await origin(OCT);
    expect(f.campaigns.groups).toBe(1);
    expect(f.campaigns.rows).toEqual([
      { campaign: 'drop-14', firstVisits: 3, collectors: 2, buyers: 1, rows: [{ source: 'ig', medium: 'story', sourceIds: expect.any(Array), firstVisits: 3, collectors: 2, buyers: 1 }] },
    ]);
    expect(f.campaigns.rows[0]!.rows[0]!.sourceIds).toHaveLength(2);
    // With a filter narrowing the collectors, the first visits are their devices'.
    const fr = await origin({ ...OCT, c: 'FR' });
    expect(fr.campaigns.rows[0]).toMatchObject({ firstVisits: 2, collectors: 2, buyers: 1 });
  });

  it('REFERRING SITES: by site, then Other sites and None (a direct first visit)', async () => {
    const f = await origin(OCT);
    expect(f.sites.rows).toEqual([{ key: 'site:vogue.fr', site: 'vogue.fr', collectors: 1, compare: { now: 1, before: 0 } }]);
    expect(f.sites.other).toEqual({ key: 'other', site: null, collectors: 0, compare: { now: 0, before: 0 } });
    expect(f.sites.none).toEqual({ key: 'none', site: null, collectors: 1, compare: { now: 1, before: 0 } });
    expect(f.sites.groups).toBe(1);
  });

  it('FIRST VISITS: by day over October (by week over 78 days), the new collectors beside them, September’s buckets, those that became collectors', async () => {
    const f = await origin(OCT);
    expect(f.firstVisits.unit).toBe('day');
    expect(f.firstVisits.buckets).toHaveLength(31);
    const byDay = Object.fromEntries(f.firstVisits.buckets.filter((b) => b.firstVisits + b.newCollectors > 0).map((b) => [b.key, [b.firstVisits, b.newCollectors]]));
    expect(byDay).toEqual({
      '2026-10-02': [1, 0],
      '2026-10-03': [2, 1],
      '2026-10-04': [1, 1],
      '2026-10-05': [1, 1],
      '2026-10-06': [3, 1],
      '2026-10-07': [2, 1],
      '2026-10-08': [1, 1],
      '2026-10-09': [1, 1],
      '2026-10-11': [1, 1],
    });
    expect(f.firstVisits.total).toBe(13);
    expect(f.firstVisits.previousTotal).toBe(1);
    expect(f.firstVisits.previous!.find((b) => b.firstVisits > 0)).toMatchObject({ key: '2026-09-15', firstVisits: 1, newCollectors: 1 });
    expect(f.firstVisits.becameCollectors).toBe(8);
    expect(f.firstLastDiffer).toEqual({ collectors: 8, differ: 1 });
    const ninety = await origin({ p: 'custom', from: '2026-08-15', to: '2026-10-31' });
    expect(ninety.firstVisits.unit).toBe('week');
    expect(ninety.firstVisits.buckets.reduce((a, b) => a + b.firstVisits, 0)).toBe(14);
  });

  it('a source filter keeps its collectors, the first visits of its sources and the links that are theirs', async () => {
    const f = await origin({ ...OCT, s: `${channel.Instagram}` });
    expect(f.total).toBe(5);
    expect(f.sources.find((s) => s.key === `channel:${channel.Instagram}`)!.collectors).toBe(5);
    expect(f.sources.filter((s) => s.collectors > 0)).toHaveLength(1);
    // The devices whose first source is a link of Instagram: A, B, C, D, Y (L3), T, H, X.
    expect(f.firstVisits.total).toBe(8);
    expect(f.links.channels[0]!.first.collectors).toBe(5);
    expect(f.firstLastDiffer).toEqual({ collectors: 4, differ: 1 });
  });
});
