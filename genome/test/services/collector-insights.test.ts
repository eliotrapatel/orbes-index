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
 *  - likes (step 9.4): the panel reads LikesService over the page's collectors (the house's wishes by hand, the
 *    scope, a filter, the comparison off); LikesService's own figures are test/services/likes.test.ts's;
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
  SCORE_SLICES,
  TREND_FIGURES,
  type DevicesPanelFigures,
  type TrendsFigures,
  type EngagementFigures,
  type BarRow,
  type CollectorsReport,
  type InsightsRequest,
  type LinkChannelRows,
  type OriginFigures,
  type OverviewFigures,
  type WhoFigures,
} from '../../src/server/services/collector-insights.js';
import { median } from '../../src/server/services/growth.js';
import { VIEW_PAGE_CODES } from '../../src/server/db/schema.js';
import type { LikesFigures } from '../../src/server/services/likes.js';
import type { DevicesFigures } from '../../src/server/services/tracking-reads.js';
import { AGE_SLICES, parisPeriod, periodBuckets, previousPeriod, type Bucket, type Period } from '../../src/server/services/insights-scope.js';
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
  /** Its place in the house's series (the history's and the devices' patterns follow it). */
  i: number;
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
      i,
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

/**
 * The devices of the accounts that signed in (step 9.6): each viewed MONOLITHE at its sign-in's instant from its own
 * device, twice ten minutes apart, then two hours later (two visits); every second one also from a Windows computer, a
 * shorter view five minutes after (one visit), which never is its main device. Views only at the sign-in's instant, so
 * the activity of the house is unchanged.
 */
type DeviceClass = { kind: 'PHONE' | 'TABLET' | 'COMPUTER'; os: 'IOS' | 'ANDROID' | 'MACOS' | 'WINDOWS'; browser: 'SAFARI' | 'CHROME' | 'EDGE'; opened_in: 'BROWSER' | 'IN_APP' | 'HOME_SCREEN'; in_app: 'INSTAGRAM' | null };
const MAIN_DEVICES: DeviceClass[] = [
  { kind: 'PHONE', os: 'IOS', browser: 'SAFARI', opened_in: 'BROWSER', in_app: null },
  { kind: 'COMPUTER', os: 'MACOS', browser: 'CHROME', opened_in: 'BROWSER', in_app: null },
  { kind: 'TABLET', os: 'IOS', browser: 'SAFARI', opened_in: 'IN_APP', in_app: 'INSTAGRAM' },
  { kind: 'PHONE', os: 'ANDROID', browser: 'CHROME', opened_in: 'HOME_SCREEN', in_app: null },
];
/** The buyers (step 9.7): every third account that signed in. */
const buyer = (s: Seed): boolean => s.loginAt !== null && s.i % 12 === 0;
const SECOND_DEVICE: DeviceClass = { kind: 'COMPUTER', os: 'WINDOWS', browser: 'EDGE', opened_in: 'BROWSER', in_app: null };
const mainDevice = (s: Seed): DeviceClass | null => (s.loginAt ? MAIN_DEVICES[(s.i / 4) % 4]! : null);
const secondDevice = (s: Seed): boolean => s.loginAt !== null && s.i % 8 === 0;

/**
 * The monthly history (step 9.6): every counted collector and test entrant made by September has a row from April (or
 * its month of sign-up) to September 2026, element k's score (i·3 + k·11) mod 101, not measured when (i + k) is a
 * multiple of 6, tier (i + k) mod 4, active when (i + k) is a multiple of 3.
 */
const HISTORY_FROM = '2026-04-01';
const HISTORY_TO = '2026-09-01';
const monthOfDay = (d: string) => `${d.slice(0, 7)}-01`;
const monthIndex = (a: string, b: string) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
const addMonths = (m: string, n: number) => {
  const k = +m.slice(0, 4) * 12 + (+m.slice(5, 7) - 1) + n;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}-01`;
};
const historyFirst = (s: Seed): string | null => {
  const m = monthOfDay(parisDay(s.created));
  return m > HISTORY_TO ? null : m > HISTORY_FROM ? m : HISTORY_FROM;
};
const historyAt = (s: Seed, month: string): { score: number | null; tier: number; active: boolean } | null => {
  const first = historyFirst(s);
  if (first === null || month < first || month > HISTORY_TO) return null;
  const k = monthIndex(first, month);
  return { score: (s.i + k) % 6 === 0 ? null : (s.i * 3 + k * 11) % 101, tier: (s.i + k) % 4, active: (s.i + k) % 3 === 0 };
};

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
    const gw = await new GrowthWorld(db).prepare();
    const orbital = (await db.insertInto('collections').values({ name: 'ORBITAL' }).returning('id').executeTakeFirstOrThrow()).id;
    const model = await gw.model('MONOLITHE', { price: [48_000, 'EUR'], collectionId: orbital });
    // Favourite pieces and finishes (step 9.8's lists): RING or CUFF for two accounts in three, BLUE for one in five.
    for (const s of HOUSE) {
      if (s.i % 3 !== 2) await db.insertInto('account_tastes').values({ account_id: s.id!, kind: 'PIECE', value_key: s.i % 3 ? 'CUFF' : 'RING', label: s.i % 3 ? 'Cuff' : 'Ring', created_at: s.created }).execute();
      if (s.i % 5 === 1) await db.insertInto('account_tastes').values({ account_id: s.id!, kind: 'FINISH', value_key: 'BLUE', label: 'Blue', created_at: s.created }).execute();
    }
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
    // The devices behind the views (step 9.6), first seen long before both periods (no first visit of theirs).
    const longAgo = new Date('2026-01-05T10:00:00Z');
    const viewDevice = async (c: DeviceClass) =>
      (
        await db
          .insertInto('tracking_devices')
          .values({ device_hash: `cv${String(++n).padStart(6, '0')}${'v'.repeat(35)}`, ...c, first_seen_at: longAgo, last_seen_at: longAgo })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    const view = (deviceId: number, s: Seed, at: Date, seconds: number) =>
      db.insertInto('collector_views').values({ at, device_id: deviceId, account_id: s.id!, page: VIEW_PAGE_CODES.MODEL, subject: model, seconds, place_id: null }).execute();
    for (const s of HOUSE) {
      const main = mainDevice(s);
      if (!main) continue;
      const d = await viewDevice(main);
      await view(d, s, s.loginAt!, 60);
      await view(d, s, new Date(s.loginAt!.getTime() + 10 * 60_000), 60);
      await view(d, s, new Date(s.loginAt!.getTime() + 2 * 3_600_000), 60);
      if (secondDevice(s)) await view(await viewDevice(SECOND_DEVICE), s, new Date(s.loginAt!.getTime() + 5 * 60_000), 10);
    }
    // Every device of two days of the period and one of the previous period, from the daily totals.
    for (const [d, country, c, devices] of [
      [day(TODAY, -3), 'FR', MAIN_DEVICES[0]!, 5],
      [day(TODAY, -3), 'IT', MAIN_DEVICES[1]!, 3],
      [day(TODAY, -40), 'FR', MAIN_DEVICES[2]!, 4],
    ] as const) {
      await db
        .insertInto('device_daily_stats')
        .values({ day: d, country, kind: c.kind, os: c.os, browser: c.browser, opened_in: c.opened_in, in_app: c.in_app ?? 'NONE', devices, new_devices: 0, signed_in_devices: 0 })
        .execute();
    }
    // Orders (step 9.7): every account of BUYERS bought MONOLITHE, reserved at its sign-in's instant (its activity
    // unchanged), paid half an hour later.
    // GrowthWorld's salon order, written here at these instants (an order's times never change once written).
    const location = (gw as unknown as { location: string }).location;
    for (const s of HOUSE.filter(buyer)) {
      const request = (
        await db
          .insertInto('shop_requests')
          .values({ account_id: s.id!, model_id: model, status: 'CLOSED', created_at: s.created, handled_at: s.loginAt!, outcome: 'ACCEPTED' })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      await db
        .insertInto('orders')
        .values({
          channel: 'SALON',
          account_id: s.id!,
          model_id: model,
          shop_request_id: request,
          price_minor: 48_000,
          currency: 'EUR',
          status: 'PAID',
          reserved_at: s.loginAt!,
          paid_at: new Date(s.loginAt!.getTime() + 30 * 60_000),
          location_id: location,
        })
        .execute();
    }
    // The monthly history (counted collectors and test entrants; neither a team account nor a DELETED one ever has a row).
    for (const s of HOUSE.filter((x) => x.kind !== 'TEAM' && x.kind !== 'DELETED')) {
      const first = historyFirst(s);
      if (first === null) continue;
      const months = Array.from({ length: monthIndex(first, HISTORY_TO) + 1 }, (_, k) => historyAt(s, addMonths(first, k))!);
      await db
        .insertInto('collector_history')
        .values({ account_id: s.id!, first_month: first, last_month: HISTORY_TO, scores: months.map((m) => m.score), tiers: months.map((m) => m.tier), active: months.map((m) => m.active) })
        .execute();
    }
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
  const PREVIOUS_MONTH = '2026-08-01';
  const keptMedian = (list: Seed[], month: string) => {
    const v = list.map((s) => historyAt(s, month)?.score ?? null).filter((x): x is number => x !== null);
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
        // The scores the history kept for August, the month that ended by the previous period's end (14 Sep).
        previous: keptMedian(before.filter((s) => s.created < B30.end), PREVIOUS_MONTH),
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

  describe('likes (What they like, step 9.4)', () => {
    const likes = async (req: Omit<InsightsRequest, 'panel'> = {}) => {
      svc.clearCache();
      const r = await svc.report({ panel: 'likes', ...req });
      expect(r.panel).toBe('likes');
      return r.figures as LikesFigures;
    };
    // Every wish of the house is on MONOLITHE, open since its day.
    const wishers = (list: Seed[], end: Date) => list.filter((s) => s.wishAt !== null && s.wishAt < end);

    it('reads LikesService over the page’s collectors: counted collectors only, the wishes open at the end, added in the period, open at the previous end', async () => {
      const f = await likes();
      expect(f.raw).toBe(true);
      expect(f.total).toBe(COUNTED.length);
      const open = wishers(COUNTED, P30.end).length;
      expect(f.wishlists).toEqual({
        collectors: open,
        share: Math.round((open * 100) / COUNTED.length),
        added: COUNTED.filter((s) => within(s.wishAt, P30)).length,
        removed: 0,
        previous: { collectors: wishers(COUNTED, B30.end).length, added: COUNTED.filter((s) => within(s.wishAt, B30)).length, removed: 0 },
      });
      expect(f.mostWished.rows.map((r) => [r.name, r.wished, r.added, r.previous])).toEqual([['MONOLITHE', open, f.wishlists.added, wishers(COUNTED, B30.end).length]]);
      // With the scope ALL and no filter, the panel is LikesService's own reading of every counted collector.
      const direct = await h.ctx.services.likes.likes({ from: P30.from, to: P30.to, start: P30.start, end: P30.end, previous: B30 });
      expect(f).toEqual(JSON.parse(JSON.stringify(direct)));
    });

    it('the filters and the scope narrow whose wishes; without the comparison, no previous value', async () => {
      const fr: Pick = (s) => s.country === 'FR';
      const f = await likes({ c: 'FR' });
      expect(f.total).toBe(inScope('all', P30, fr).length);
      expect(f.wishlists.collectors).toBe(wishers(inScope('all', P30, fr), P30.end).length);
      const fresh = await likes({ scope: 'new' });
      expect(fresh.total).toBe(inScope('new', P30).length);
      expect(fresh.wishlists.collectors).toBe(wishers(inScope('new', P30), P30.end).length);
      // NEW compares with the previous period's new collectors.
      expect(fresh.wishlists.previous?.collectors).toBe(wishers(inScope('new', B30), B30.end).length);
      const off = await likes({ cmp: false });
      expect(off.wishlists.previous).toBeNull();
      expect(off.mostWished.rows.every((r) => r.previous === null)).toBe(true);
    });
  });

  describe('devices (Devices, step 9.6)', () => {
    const devicesOf = async (req: Omit<InsightsRequest, 'panel'> = {}) => {
      svc.clearCache();
      const r = await svc.report({ panel: 'devices', ...req });
      expect(r.panel).toBe('devices');
      return r.figures as DevicesPanelFigures;
    };
    /** The hand's figures of a set of devices (each counted `weight` times). */
    const fold = (items: { c: DeviceClass; weight: number }[]) => {
      const out = { total: 0, kinds: {} as Record<string, number>, systems: {} as Record<string, number>, openedIn: {} as Record<string, number>, apps: {} as Record<string, number> };
      const add = (m: Record<string, number>, k: string, n: number) => (m[k] = (m[k] ?? 0) + n);
      for (const { c, weight } of items) {
        out.total += weight;
        add(out.kinds, c.kind, weight);
        add(out.systems, c.os === 'IOS' && c.kind === 'TABLET' ? 'IPAD' : c.os, weight);
        add(out.openedIn, c.opened_in, weight);
        if (c.in_app) add(out.apps, c.in_app, weight);
      }
      return out;
    };
    const nonZero = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).filter(([, n]) => n > 0));
    const asHand = (f: DevicesFigures) => ({ total: f.total, kinds: nonZero(f.kinds), systems: nonZero(f.systems), openedIn: nonZero(f.openedIn), apps: nonZero(f.apps) });
    const viewersIn = (list: Seed[], p: Period) => list.filter((s) => within(s.loginAt, p));

    it('BY COLLECTORS: each collector once under its main device; BY VISITS: every visit; counted collectors only, with the previous period', async () => {
      const f = await devicesOf();
      expect(f.total).toBe(200);
      const now = viewersIn(COUNTED, P30);
      const before = viewersIn(COUNTED, B30);
      expect(now.length).toBeGreaterThan(5);
      expect(asHand(f.byCollectors.current)).toEqual(fold(now.map((s) => ({ c: mainDevice(s)!, weight: 1 }))));
      expect(asHand(f.byCollectors.previous!)).toEqual(fold(before.map((s) => ({ c: mainDevice(s)!, weight: 1 }))));
      const visitsOf = (list: Seed[]) => list.flatMap((s) => [{ c: mainDevice(s)!, weight: 2 }, ...(secondDevice(s) ? [{ c: SECOND_DEVICE, weight: 1 }] : [])]);
      expect(asHand(f.byVisits.current)).toEqual(fold(visitsOf(now)));
      expect(asHand(f.byVisits.previous!)).toEqual(fold(visitsOf(before)));
      // An iPad on its own line, inside Instagram; the browsers, the top six at most, the most first.
      expect(f.byCollectors.current.systems.IPAD).toBe(now.filter((s) => mainDevice(s)!.kind === 'TABLET').length);
      expect(f.byCollectors.current.browsers.length).toBeLessThanOrEqual(6);
      expect(f.byVisits.current.browsers.map((b) => b.browser)).toContain('EDGE');
      expect(f.reachesBackTo).toBeNull();
    });

    it('ALL DEVICES: the daily totals, anonymous included, the country filter applied to the connection’s country', async () => {
      const f = await devicesOf();
      expect(f.allDevices.current.total).toBe(8);
      expect(f.allDevices.current.kinds).toMatchObject({ PHONE: 5, COMPUTER: 3 });
      expect(f.allDevices.previous!.total).toBe(4);
      expect(f.allDevices.previous!.systems.IPAD).toBe(4);
      const fr = await devicesOf({ c: 'FR' });
      expect(fr.allDevices.current.total).toBe(5);
      // The collectors' tabs follow the collectors of France (the account's country).
      expect(fr.byCollectors.current.total).toBe(viewersIn(COUNTED.filter((s) => s.country === 'FR'), P30).length);
    });

    it('the scope and the filters narrow the collectors’ tabs; without the comparison, no previous figures', async () => {
      const fresh = await devicesOf({ scope: 'new', cmp: false });
      expect(fresh.byCollectors.previous).toBeNull();
      expect(fresh.allDevices.previous).toBeNull();
      expect(fresh.total).toBe(inScope('new', P30).length);
      expect(fresh.byCollectors.current.total).toBe(viewersIn(inScope('new', P30), P30).length);
      const scored = await devicesOf({ sc: '0-50' });
      expect(scored.byCollectors.current.total).toBe(viewersIn(COUNTED.filter((s) => s.score !== null && s.score <= 50), P30).length);
    });
  });

  describe('engagement (Engagement, step 9.6)', () => {
    const engagement = async (req: Omit<InsightsRequest, 'panel'> = {}) => {
      svc.clearCache();
      const r = await svc.report({ panel: 'engagement', ...req });
      expect(r.panel).toBe('engagement');
      return r.figures as EngagementFigures;
    };
    const slice = (score: number | null) => (score === null ? 'none' : SCORE_SLICES[Math.min(9, Math.floor(score / 10))]!);
    const spread = (scores: (number | null)[]) => {
      const m = new Map<string, number>([...SCORE_SLICES, 'none'].map((k) => [k, 0]));
      for (const v of scores) m.set(slice(v), m.get(slice(v))! + 1);
      return m;
    };
    /** ACTIVE AND DORMANT by hand: the house's acts are its sign-ins and the views at their instant. */
    const status = (s: Seed, p: Period): string => {
      const firstEnd = parisDayStart(day(parisDay(s.created), 1));
      const last = s.loginAt && s.loginAt < p.end ? s.loginAt : null;
      if (last === null || last < firstEnd) return 'never';
      const windowStart = parisDayStart(day(p.to, -89));
      return last >= (firstEnd > windowStart ? firstEnd : windowStart) ? 'active' : 'dormant';
    };

    it('SCORE SPREAD: ten bands and Not measured, the median; the spread of August from the history beside it', async () => {
      const f = await engagement();
      expect(f.total).toBe(200);
      const now = spread(COUNTED.map((s) => s.score));
      const before = spread(COUNTED.filter((s) => s.created < B30.end).map((s) => historyAt(s, PREVIOUS_MONTH)?.score ?? null));
      expect(f.spread.rows).toEqual([...SCORE_SLICES, 'none'].map((key) => ({ key, collectors: now.get(key)!, previous: before.get(key)! })));
      expect(f.spread.previousMonth).toBe(PREVIOUS_MONTH);
      expect(f.spread.scored).toBe(COUNTED.filter((s) => s.score !== null).length);
      expect(f.spread.median).toBe(scoreMedian(COUNTED));
      // LAST 12 MONTHS: the previous period ended in October 2025, which the history does not hold.
      const year = await engagement({ p: '12m' });
      expect(year.spread.previousMonth).toBeNull();
      expect(year.spread.rows.every((r) => r.previous === null)).toBe(true);
    });

    it('THE FIVE PARTS: the averages of the scored collectors, each out of its maximum, withheld under 3', async () => {
      const f = await engagement();
      const scored = COUNTED.filter((s) => s.score !== null).map((s) => s.score!);
      const maxima = [25, 20, 25, 10, 20];
      const partsOf = (score: number) => {
        let left = score;
        return maxima.map((m) => {
          const p = Math.min(m, left);
          left -= p;
          return p;
        });
      };
      const avg = (k: number) => Math.round((scored.reduce((a, v) => a + partsOf(v)[k]!, 0) / scored.length) * 10) / 10;
      expect(f.parts).toEqual(['recency', 'frequency', 'spend', 'speed', 'attendance'].map((key, k) => ({ key, max: maxima[k], average: avg(k), collectors: scored.length })));
      const few = await engagement({ sc: '100-100' });
      expect(few.parts.every((p) => p.average === null && p.collectors < 3)).toBe(true);
    });

    it('ACTIVE AND DORMANT as of the period’s last day: active in the 90 days, dormant before, never after the first day; and as of the previous period’s', async () => {
      const f = await engagement();
      const count = (list: Seed[], p: Period) => {
        const m = new Map<string, number>([['active', 0], ['dormant', 0], ['never', 0]]);
        for (const s of list.filter((x) => x.created < p.end)) m.set(status(s, p), m.get(status(s, p))! + 1);
        return m;
      };
      const now = count(COUNTED, P30);
      const before = count(COUNTED, B30);
      expect(f.status).toEqual({ asOf: TODAY, previousAsOf: B30.to, rows: ['active', 'dormant', 'never'].map((key) => ({ key, collectors: now.get(key)!, previous: before.get(key)! })) });
      for (const k of ['active', 'dormant', 'never']) expect(now.get(k), k).toBeGreaterThan(0);
      // The scope NEW: the collectors made in the period, as of its end.
      const fresh = await engagement({ scope: 'new' });
      const freshNow = count(inScope('new', P30), P30);
      expect(fresh.status.rows.map((r) => r.collectors)).toEqual(['active', 'dormant', 'never'].map((k) => freshNow.get(k)!));
    });

    it('MONTHLY COHORTS: the 12 months to October, the newest first, each mark from the history’s activity, « — » past September', async () => {
      const f = await engagement();
      expect(f.cohorts.through).toBe('2026-09');
      expect(f.cohorts.rows.map((r) => r.month)).toEqual(Array.from({ length: 12 }, (_, i) => addMonths('2026-10-01', -i).slice(0, 7)));
      for (const row of f.cohorts.rows) {
        const cohort = COUNTED.filter((s) => parisDay(s.created).slice(0, 7) === row.month);
        expect(row.collectors, row.month).toBe(cohort.length);
        for (const mark of row.marks) {
          const target = addMonths(`${row.month}-01`, mark.after);
          if (target > HISTORY_TO) {
            expect(mark, `${row.month} +${mark.after}`).toEqual({ after: mark.after, active: null, share: null });
            continue;
          }
          const active = cohort.filter((s) => historyAt(s, target)?.active === true).length;
          expect(mark, `${row.month} +${mark.after}`).toEqual({ after: mark.after, active, share: cohort.length ? Math.round((active * 100) / cohort.length) : null });
        }
      }
      expect(f.cohorts.rows.find((r) => r.month === '2026-07')!.marks[0]!.active).toBeGreaterThan(0);
    });
  });

  describe('trends (Over time, step 9.7)', () => {
    const trends = async (req: Omit<InsightsRequest, 'panel'> = {}) => {
      svc.clearCache();
      const r = await svc.report({ panel: 'trends', ...req });
      expect(r.panel).toBe('trends');
      return r.figures as TrendsFigures;
    };
    const inBucket = (at: Date | null, b: Bucket) => at !== null && at >= b.start && at < b.end;
    const viewsOf = (s: Seed) => (mainDevice(s) ? 3 + (secondDevice(s) ? 1 : 0) : 0);
    /** A figure by hand for the collectors `list` over a bucket: [value, collectors behind it]. */
    const hand = (figure: string, list: Seed[], b: Bucket, p: Period): [number | null, number] => {
      const count = (f: (s: Seed) => boolean): [number, number] => {
        const n = list.filter(f).length;
        return [n, n];
      };
      switch (figure) {
        case 'collectors':
          return count((s) => s.created < b.end);
        case 'new':
          return count((s) => inBucket(s.created, b));
        case 'firstvisits':
          return [devices.filter((d) => inBucket(d.at, b)).length, list.filter((s) => inBucket(s.firstSeenAt, b)).length];
        case 'active':
          return count((s) => inBucket(s.loginAt, b));
        case 'medianscore': {
          // This morning's scores for the bucket holding now; the month the history kept for a bucket ending a month.
          const month = `${b.to.slice(0, 7)}-01`;
          const monthEnd = day(addMonths(month, 1), -1) === b.to;
          const scores =
            NOW >= b.start && NOW < b.end
              ? list.filter((s) => s.score !== null).map((s) => s.score!)
              : monthEnd
                ? list.filter((s) => s.created < b.end).map((s) => historyAt(s, month)?.score ?? null).filter((v): v is number => v !== null)
                : [];
          return [scores.length >= 3 ? median(scores) : null, scores.length];
        }
        case 'wishes':
          return count((s) => inBucket(s.wishAt, b));
        case 'views': {
          const viewers = list.filter((s) => inBucket(s.loginAt, b) && viewsOf(s) > 0);
          return [viewers.reduce((a, s) => a + viewsOf(s), 0), viewers.length];
        }
        case 'buyers':
          return count((s) => buyer(s) && inBucket(new Date(s.loginAt!.getTime() + 30 * 60_000), b) && within(new Date(s.loginAt!.getTime() + 30 * 60_000), p));
      }
      throw new Error(figure);
    };
    const line = (figure: string, list: Seed[], p: Period) =>
      periodBuckets(p).map((b) => {
        const [value, collectors] = hand(figure, list, b, p);
        return { key: b.key, from: b.from, to: b.to, value, collectors };
      });

    it('each figure by Paris day over LAST 30 DAYS, with the previous period’s line, counted collectors only', async () => {
      for (const figure of TREND_FIGURES) {
        const f = await trends({ figure });
        expect(f, figure).toMatchObject({ figure, split: 'none', unit: 'day', groups: [] });
        expect(f.total, figure).toEqual(line(figure, COUNTED, P30));
        expect(f.previous, figure).toEqual(line(figure, COUNTED, B30));
        expect(f.total.some((x) => (x.value ?? 0) > 0), figure).toBe(true);
      }
      // The default figure is Collectors, the split Nothing; without the comparison, no previous line.
      expect(await trends({ cmp: false })).toMatchObject({ figure: 'collectors', split: 'none', previous: null });
    });

    it('split by country, by age (six groups, then Other), by device, by source; the groups add up to the line', async () => {
      const byCountry = await trends({ split: 'country' });
      const country = (s: Seed) => s.country ?? 'none';
      expect(byCountry.groups.map((g) => g.group).sort()).toEqual(['FR', 'GB', 'IT', 'none']);
      for (const g of byCountry.groups) expect(g.points, g.group).toEqual(line('collectors', COUNTED.filter((s) => country(s) === g.group), P30));
      expect(byCountry.total).toEqual(line('collectors', COUNTED, P30));

      // AGES has eight slices: the six with most new collectors are named, the two others summed as Other.
      const byAge = await trends({ split: 'age', figure: 'new' });
      const age = (s: Seed) => (s.birth ? bandOfAge(ageOn(s.birth, TODAY)) : 'none');
      const sizes = new Map<string, number>();
      for (const s of COUNTED.filter((x) => within(x.created, P30))) sizes.set(age(s), (sizes.get(age(s)) ?? 0) + 1);
      const named = [...sizes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 6).map(([k]) => k);
      expect(byAge.groups.map((g) => g.group)).toEqual(sizes.size > 6 ? [...named, 'other'] : named);
      const other = byAge.groups.find((g) => g.group === 'other');
      if (other) expect(other.points).toEqual(line('new', COUNTED.filter((s) => !named.includes(age(s))), P30));
      const sum = (key: string) => byAge.groups.reduce((a, g) => a + (g.points.find((x) => x.key === key)!.value ?? 0), 0);
      for (const x of byAge.total) expect(sum(x.key), x.key).toBe(x.value);

      // By device: the kind of each collector's main device in the period, Unknown without a view.
      const byDevice = await trends({ split: 'device', figure: 'active' });
      const kind = (s: Seed) => (within(s.loginAt, P30) ? mainDevice(s)!.kind : 'unknown');
      for (const g of byDevice.groups) expect(g.points, g.group).toEqual(line('active', COUNTED.filter((s) => kind(s) === g.group), P30));

      // First visits by country: the devices linked to a collector of France, the rest (a test entrant's, anonymous) as visitor.
      // The collectors behind each group are those whose first visit fell in the bucket, whatever device (here they
      // carry no linked device: the other countries have collectors behind and no first visit).
      const visits = await trends({ split: 'country', figure: 'firstvisits' });
      const groupsOf = visits.groups.map((g) => g.group);
      expect(groupsOf[0]).toBe('FR');
      expect(groupsOf[groupsOf.length - 1]).toBe('visitor');
      const linked = (b: Bucket) => devices.filter((d) => inBucket(d.at, b) && d.linkedTo !== null && d.linkedTo.kind !== 'TEST').length;
      expect(visits.groups[0]!.points.map((x) => x.value)).toEqual(periodBuckets(P30).map(linked));
      expect(visits.groups.at(-1)!.points.map((x) => x.value)).toEqual(periodBuckets(P30).map((b) => devices.filter((d) => inBucket(d.at, b)).length - linked(b)));
      for (const g of visits.groups.slice(1, -1)) {
        expect(g.points.every((x) => x.value === 0), g.group).toBe(true);
        expect(g.points.map((x) => x.collectors), g.group).toEqual(periodBuckets(P30).map((b) => COUNTED.filter((s) => country(s) === g.group && inBucket(s.firstSeenAt, b)).length));
      }

      // By source: every collector of the house came first direct (or has no row, after the recording's start).
      const bySource = await trends({ split: 'source' });
      expect(bySource.groups.map((g) => g.group)).toEqual(['kind:DIRECT']);
    });

    it('LAST 12 MONTHS by month: the median score from the history at each month’s end it holds, this morning’s for October', async () => {
      const f = await trends({ p: '12m', figure: 'medianscore', cmp: false });
      expect(f.unit).toBe('month');
      const P12 = parisPeriod({ p: '12m' }, NOW);
      const byMonth = Object.fromEntries(f.total.map((x) => [x.key, x.value]));
      for (const month of ['2026-06', '2026-07', '2026-08', '2026-09']) {
        const v = COUNTED.filter((s) => s.created < parisDayStart(day(`${month}-01`, 40).slice(0, 7) + '-01'))
          .map((s) => historyAt(s, `${month}-01`)?.score ?? null)
          .filter((x): x is number => x !== null);
        expect(byMonth[month], month).toBe(v.length >= 3 ? median(v) : null);
      }
      expect(byMonth['2026-10']).toBe(scoreMedian(COUNTED));
      expect(byMonth['2026-01']).toBeNull();
      expect(f.total[0]!.from).toBe(P12.from);
    });

    it('refuses another figure or split (400 VALIDATION_FAILED); the figure and the split are part of the cached view', async () => {
      await expect(svc.report({ panel: 'trends', figure: 'revenue' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(svc.report({ panel: 'trends', split: 'city' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      svc.clearCache();
      const a = await svc.report({ panel: 'trends', figure: 'new' });
      const b = await svc.report({ panel: 'trends', figure: 'active' });
      expect(a).not.toBe(b);
      expect(await svc.report({ panel: 'trends', figure: 'new' })).toBe(a);
    });
  });

  describe('the click-through (step 9.8): each figure equals its list’s total', () => {
    const panel = async <T,>(name: string, req: Omit<InsightsRequest, 'panel'> = {}) => {
      svc.clearCache();
      return (await svc.report({ panel: name, ...req })).figures as T;
    };
    /** Every [slice, figure] pair: each list read, its total compared; the mismatches named together. */
    const check = async (pairs: [string, number][], req: Omit<InsightsRequest, 'panel'> = {}) => {
      const wrong: string[] = [];
      for (const [slice, n] of pairs) {
        const total = (await svc.list({ ...req, slice }, { withCities: true })).total;
        if (total !== n) wrong.push(`${slice}: list ${total}, figure ${n}`);
      }
      expect(wrong).toEqual([]);
      return pairs.length;
    };

    it('At a glance, Who they are, What they like', async () => {
      for (const req of [{}, { scope: 'new' as const, c: 'FR,IT' }]) {
        const o = await panel<OverviewFigures>('overview', req);
        await check(
          [
            ['all', o.collectors.value!],
            ['new', o.newCollectors.value!],
            ['active', o.active.value!],
            ['firstvisit', o.firstVisits.becameCollectors],
            ['scored', o.medianScore.scored],
            ['wished', o.wishesAdded.collectors],
          ],
          req,
        );
        const w = await panel<WhoFigures>('who', req);
        await check(
          [
            ...w.ages.rows.map((r): [string, number] => [`age:${r.key}`, r.collectors]),
            ...w.countries.given.map((r): [string, number] => [`country:${r.key}`, r.collectors]),
            ...w.countries.connection.map((r): [string, number] => [`conncountry:${r.key}`, r.collectors]),
            ...w.cities.given.rows.map((r): [string, number] => [`city:${r.key}`, r.collectors]),
            ...w.cities.connection.rows.map((r): [string, number] => [`conncity:${r.key}`, r.collectors]),
          ],
          req,
        );
        const l = await panel<LikesFigures>('likes', req);
        await check(
          [
            ['haswish', l.wishlists.collectors!],
            ...l.mostWished.rows.flatMap((r) => [r, ...r.variants]).map((r): [string, number] => [`wishmodel:${r.modelId}`, r.wished]),
            ...l.collections.rows.map((r): [string, number] => [`wishcollection:${r.collectionId}`, r.collectors]),
            ...l.pieces.rows.map((r): [string, number] => [`favpiece:${r.key}`, r.collectors]),
            ['favpiece:none', l.pieces.none],
            ...l.finishes.rows.map((r): [string, number] => [`favfinish:${r.key}`, r.collectors]),
            ['favfinish:none', l.finishes.none],
            ...l.viewed.collectors.models.flatMap((r) => [r, ...r.variants]).map((r): [string, number] => [`viewed:${r.modelId}`, r.collectors!]),
            ...l.viewed.collectors.releases.map((r): [string, number] => [`viewed:r:${r.dropId}`, r.collectors!]),
            ...l.held.rows.flatMap((r) => [r, ...r.variants]).map((r): [string, number] => [`holds:${r.modelId}`, r.collectors]),
          ],
          req,
        );
        expect(l.collections.rows.length + l.pieces.rows.length + l.viewed.collectors.models.length).toBeGreaterThan(2);
      }
    });

    it('Devices (BY COLLECTORS) and Engagement: the spread, the parts, the statuses, every cohort cell', async () => {
      const d = await panel<DevicesPanelFigures>('devices');
      const f = d.byCollectors.current;
      await check([
        ...Object.entries(f.kinds).map(([k, n]): [string, number] => [`device:${k}`, n]),
        ...Object.entries(f.systems).map(([k, n]): [string, number] => [`system:${k}`, n]),
        ...Object.entries(f.openedIn).map(([k, n]): [string, number] => [`openedin:${k}`, n]),
        ...Object.entries(f.apps).map(([k, n]): [string, number] => [`app:${k}`, n]),
      ]);
      for (const req of [{}, { scope: 'active' as const }]) {
        const e = await panel<EngagementFigures>('engagement', req);
        await check(
          [
            ...e.spread.rows.map((r): [string, number] => [`score:${r.key}`, r.collectors]),
            ...e.parts.map((p): [string, number] => [`part:${p.key}`, p.collectors]),
            ...e.status.rows.map((r): [string, number] => [`status:${r.key}`, r.collectors]),
            ...e.cohorts.rows.flatMap((c): [string, number][] => [
              [`cohort:${c.month}:all`, c.collectors],
              ...c.marks.filter((m) => m.active !== null).flatMap((m): [string, number][] => [
                [`cohort:${c.month}:${m.after}:active`, m.active!],
                [`cohort:${c.month}:${m.after}:inactive`, c.collectors - m.active!],
              ]),
            ]),
          ],
          req,
        );
      }
    });

    it('Over time: every point of every figure, the previous period’s line, a split’s groups with Other', async () => {
      for (const figure of TREND_FIGURES) {
        const t = await panel<TrendsFigures>('trends', { figure, p: '7d' });
        await check(
          [...t.total, ...t.previous!].map((x): [string, number] => [`bucket:trend:${figure}:${x.key}`, x.collectors]),
          { figure, p: '7d' },
        );
      }
      const year = await panel<TrendsFigures>('trends', { figure: 'medianscore', p: '12m' });
      await check(year.total.map((x): [string, number] => [`bucket:trend:medianscore:${x.key}`, x.collectors]), { p: '12m' });
      for (const [figure, split] of [['new', 'age'], ['collectors', 'country'], ['active', 'device'], ['buyers', 'tier']] as const) {
        const t = await panel<TrendsFigures>('trends', { figure, split });
        const pairs = t.groups.flatMap((g) => g.points.map((x): [string, number] => [`bucket:trend:${figure}:${x.key}:${g.group}`, x.collectors]));
        expect(pairs.length).toBeGreaterThan(0);
        await check(pairs, { figure, split });
      }
      // A group without the split it belongs to, or a bucket of neither period: 400.
      await expect(svc.list({ slice: 'bucket:trend:new:2026-10-01:FR' }, { withCities: true })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(svc.list({ slice: 'bucket:trend:new:2025-01-01' }, { withCities: true })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('a list: 50 a page ordered by email, no score, the city withheld on request, the page’s query applied', async () => {
      const first = await svc.list({ slice: 'all' }, { withCities: true });
      expect(first).toMatchObject({ slice: 'all', subject: null, total: 200, page: 1, pageSize: 50, scope: 'all', period: { from: P30.from, to: P30.to } });
      expect(first.rows).toHaveLength(50);
      const second = await svc.list({ slice: 'all', page: 4 }, { withCities: true });
      expect(second.rows).toHaveLength(50);
      const emails = [...first.rows, ...second.rows].map((r) => r.email);
      expect(emails.slice(0, 50)).toEqual([...emails.slice(0, 50)].sort());
      expect(JSON.stringify([first, second])).not.toMatch(/score/i);
      expect(Object.keys(first.rows[0]!).sort()).toEqual(['accountId', 'city', 'country', 'createdAt', 'email', 'lastSeenAt', 'name', 'tier']);
      const withCity = first.rows.find((r) => r.city !== null);
      expect(withCity).toBeDefined();
      expect((await svc.list({ slice: 'all' }, { withCities: false })).rows.every((r) => r.city === null)).toBe(true);
      // A collector who signed in carries its last view; the filters and the scope narrow every list.
      expect(first.rows.concat(second.rows).some((r) => r.lastSeenAt !== null)).toBe(true);
      expect((await svc.list({ slice: 'all', c: 'FR' }, { withCities: true })).total).toBe(COUNTED.filter((s) => s.country === 'FR').length);
      expect((await svc.list({ slice: 'all', scope: 'new' }, { withCities: true })).total).toBe(inScope('new', P30).length);
      expect((await svc.list({ slice: `wishmodel:${(await panel<LikesFigures>('likes')).mostWished.rows[0]!.modelId}` }, { withCities: true })).subject).toBe('MONOLITHE');
    });

    it('refuses a slice outside its dimension’s values, a page out of bounds (400), before any reading', async () => {
      for (const slice of ['everyone', 'all:1', 'age:30-40', 'country:fra', 'source:instagram', 'score:5-9', 'part:luck', 'status:asleep', 'cohort:2026-03:2:active', 'device:WATCH', 'viewed:r:1', 'city:Lyon', 'bucket:week:2026-W40']) {
        await expect(svc.list({ slice }, { withCities: true }), slice).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      }
      await expect(svc.list({ slice: 'all', page: 0 }, { withCities: true })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
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
        { panel: 'nothing' },
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
      // The history's first month: the earliest row's (the house's first accounts were made in June).
      snapshotsSince: HOUSE.filter((x) => x.kind !== 'TEAM' && x.kind !== 'DELETED')
        .map(historyFirst)
        .filter((m): m is string => m !== null)
        .sort()[0],
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
    // What they like (step 9.8's lists, question 16): MONOLITHE · Blue, a variant in ORBITAL; wishes, pieces held, views.
    const orbital = (await h.t.db.insertInto('collections').values({ name: 'ORBITAL' }).returning('id').executeTakeFirstOrThrow()).id;
    // A main model of variants carries its own label.
    await h.t.db.updateTable('models').set({ variant_label: 'Silver', variant_swatch: '#C0C0C0' }).where('id', '=', model).execute();
    const blue = await w.model('MONOLITHE', { variantOf: model, label: 'Blue', swatch: '#1F3A93', collectionId: orbital });
    const wish = (key: string, modelId: string, added: string, removed: string | null = null) =>
      h.t.db.insertInto('account_wishes').values({ account_id: acc[key]!, model_id: modelId, added_at: z(added), removed_at: removed ? z(removed) : null }).execute();
    await wish('A', model, '2026-10-07T10:00:00Z');
    await wish('B', blue, '2026-10-08T10:00:00Z');
    await wish('C', model, '2026-10-09T10:00:00Z');
    await wish('C', blue, '2026-10-09T11:00:00Z');
    await wish('D', blue, '2026-10-05T10:00:00Z', '2026-10-20T10:00:00Z');
    await wish('T', blue, '2026-10-08T10:00:00Z');
    await w.own(acc.A!, await w.piece(blue), 'FIRST_REGISTRATION', '2026-07-01');
    await w.own(acc.B!, await w.piece(model), 'FIRST_REGISTRATION', '2026-07-01');
    await w.own(acc.T!, await w.piece(blue), 'FIRST_REGISTRATION', '2026-07-01');
    const noir = await w.drop({ mode: 'DRAW', modelId: model, title: 'MONOLITHE NOIR', opens: '2026-10-01', quantity: 5 });
    const watcher = (await h.t.db.insertInto('tracking_devices').values({ device_hash: `owatch${'w'.repeat(37)}`, first_seen_at: z('2026-08-01T10:00:00Z'), last_seen_at: z('2026-10-12T10:00:00Z') }).returning('id').executeTakeFirstOrThrow()).id;
    for (const [key, page, subject] of [['D', VIEW_PAGE_CODES.MODEL, model], ['E', VIEW_PAGE_CODES.MODEL, blue], ['F', VIEW_PAGE_CODES.RELEASE, noir.id], ['T', VIEW_PAGE_CODES.MODEL, blue]] as const) {
      await h.t.db.insertInto('collector_views').values({ at: z('2026-10-12T10:00:00Z'), device_id: watcher, account_id: acc[key]!, page, subject, seconds: 30, place_id: null }).execute();
    }
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

  it('the click-through (step 9.8): each figure equals its list’s total, the most wished rows and collections included (question 16)', async () => {
    const check = async (pairs: [string, number][], req: Omit<InsightsRequest, 'panel'>) => {
      const wrong: string[] = [];
      for (const [slice, n] of pairs) {
        const total = (await svc.list({ ...req, slice }, { withCities: true })).total;
        if (total !== n) wrong.push(`${slice}: list ${total}, figure ${n}`);
      }
      expect(wrong).toEqual([]);
    };
    for (const req of [OCT, { ...OCT, scope: 'new' as const }]) {
      const f = await origin(req);
      await check(
        [
          ...f.sources.map((b): [string, number] => [`source:${b.key}`, b.collectors]),
          ...f.heard.map((b): [string, number] => [`heard:${b.key}`, b.collectors]),
          ['heardother', f.heard.find((b) => b.other)!.collectors],
          ...f.links.channels.flatMap((c) => c.links).flatMap((l): [string, number][] => [
            [`link1:${l.link.id}`, l.first.collectors],
            [`link2:${l.link.id}`, l.last.collectors],
          ]),
          ...f.campaigns.rows.map((c): [string, number] => [`campaign:${c.campaign ?? 'none'}`, c.collectors]),
          ...f.sites.rows.map((b): [string, number] => [`referrer:${b.site}`, b.collectors]),
          ['referrer:none', f.sites.none.collectors],
          ...[...f.firstVisits.buckets, ...f.firstVisits.previous!].flatMap((b): [string, number][] => [
            [`bucket:signup:${b.key}`, b.newCollectors],
            [`bucket:firstvisit:${b.key}`, b.becameCollectors],
          ]),
        ],
        req,
      );
    }
    svc.clearCache();
    const l = (await svc.report({ panel: 'likes', ...OCT })).figures as LikesFigures;
    const main = l.mostWished.rows.find((r) => r.name === 'MONOLITHE')!;
    // The main row counts A, B and C once each (B and C through Blue); Blue's own row B and C; ORBITAL B and C.
    expect([main.wished, main.variants.map((v) => [v.variant, v.wished])]).toEqual([3, [['Blue', 2]]]);
    expect(l.collections.rows.map((c) => [c.name, c.collectors])).toEqual([['ORBITAL', 2]]);
    await check(
      [
        ['haswish', l.wishlists.collectors!],
        ...l.mostWished.rows.flatMap((r) => [r, ...r.variants]).map((r): [string, number] => [`wishmodel:${r.modelId}`, r.wished]),
        ...l.collections.rows.map((r): [string, number] => [`wishcollection:${r.collectionId}`, r.collectors]),
        ...l.held.rows.flatMap((r) => [r, ...r.variants]).map((r): [string, number] => [`holds:${r.modelId}`, r.collectors]),
        ...l.viewed.collectors.models.flatMap((r) => [r, ...r.variants]).map((r): [string, number] => [`viewed:${r.modelId}`, r.collectors!]),
        ...l.viewed.collectors.releases.map((r): [string, number] => [`viewed:r:${r.dropId}`, r.collectors!]),
      ],
      OCT,
    );
    expect(l.held.rows[0]!.variants.length + l.viewed.collectors.releases.length).toBeGreaterThan(1);
    // A most wished row's list names the model and opens its collectors, ordered by email; Other's words in its list.
    const blueRow = main.variants[0]!;
    const list = await svc.list({ ...OCT, slice: `wishmodel:${blueRow.modelId}` }, { withCities: true });
    expect(list.subject).toBe('MONOLITHE · Blue');
    expect(list.rows.map((r) => r.accountId).sort()).toEqual([acc.B!, acc.C!].sort());
    expect((await svc.list({ ...OCT, slice: `wishcollection:${l.collections.rows[0]!.collectionId}` }, { withCities: true })).subject).toBe('ORBITAL');
    const other = await svc.list({ ...OCT, slice: 'heardother' }, { withCities: true });
    expect(other.rows.map((r) => [r.accountId, r.heardOther])).toEqual([[acc.B!, 'a stylist']]);
    expect((await svc.list({ ...OCT, slice: `link1:${link.L1}` }, { withCities: true })).subject).toBe('Instagram bio');
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
