/**
 * The house the Collectors page's performance test reads (plan CUSTOMER INTELLIGENCE §3.6 C.6.8 and C.13
 * « Performance », step 9.14; test/perf/collector-insights.perf.test.ts), written in bulk (generate_series), as
 * test data is. At scale 1:
 *
 *  - 20,000 counted collectors (one in 200 LOCKED), 5,000 test accounts (test_entrants), 2 team accounts (their email
 *    a console login's) and 200 DELETED accounts, created over the 13 months of the recording and the year before;
 *    every one with a profile (a date of birth for seven in ten, a city for six in ten from 150 cities typed in three
 *    spellings, how they heard for one in two), tastes, wishes on 32 models (24 main models in 3 collections, 8
 *    variants), tags for one in ten;
 *  - ≈ 90,000 remembered devices (each account's, a second one for one collector in three, the rest anonymous), linked
 *    to their accounts, each first seen through Direct or one of 30 links, 40 sites and 300 campaigns, with their
 *    visits, the accounts' first sources and their conversions (sign-ups, draw entries, orders);
 *  - 3,000,000 raw views and scans over the 13 Paris months (C.6.8's stress volume), in time order, one in two of a
 *    signed-in device, then every day counted and every closed month written by the views' own daily job
 *    (`aggregateViews`: view_daily_stats, device_daily_stats, collector_places, collector_view_months), and the
 *    acquisition's days summarised by its own job (`summariseDays`);
 *  - 13,000 pieces held (one in two collectors holds one, one in fifty six, one in two hundred sixteen: the three tiers),
 *    6,000 paid orders with their invoices, 13 monthly draws with 30,000 entries, 40,000 scans, 150,000 sign-ins
 *    (audit_logs `account.login`);
 *  - a score for nine counted collectors in ten (account_scores, this morning's engagement_runs row) and each counted
 *    collector's monthly history (collector_history, up to 12 months).
 *
 * `scale` multiplies every count (a smaller house to try the readings on PGlite); `VACUUM ANALYZE` ends it, as
 * autovacuum would have on the box.
 */
import { sql, type RawBuilder } from 'kysely';
import type { Db } from '../../src/server/db/connection.js';
import { VIEW_PAGE_CODES } from '../../src/server/db/schema.js';
import { AcquisitionService } from '../../src/server/services/acquisition.js';
import { summariseDays } from '../../src/server/services/acquisition-jobs.js';
import { parisDay, parisDayStart, parisMonthStart } from '../../src/server/services/schedule.js';
import { aggregateViews } from '../../src/server/services/tracking-jobs.js';
import { addParisDays } from '../../src/server/services/tracking-reads.js';
import { nextParisDay, viewHistoryCutoff } from '../../src/server/services/tracking.js';
import { GrowthWorld } from '../support/growth.js';

/** The house's now: a Wednesday, 12:00 Paris. */
export const PERF_NOW = new Date('2026-10-14T10:00:00.000Z');

/** The house's counts at scale 1. */
export const PERF_HOUSE = Object.freeze({
  collectors: 20_000,
  testAccounts: 5_000,
  team: 2,
  deleted: 200,
  anonymousDevices: 58_000,
  views: 3_000_000,
  links: 30,
  sites: 40,
  campaigns: 300,
  orders: 6_000,
  entries: 30_000,
  scans: 40_000,
  logins: 150_000,
  cities: 150,
  places: 300,
});

/** What the test names in its rules and slices. */
export interface PerfHouse {
  collectors: number;
  models: string[];
  mainModels: string[];
  collections: string[];
  drops: string[];
  links: string[];
  channels: string[];
  heardOptions: string[];
  /** A counted collector of the house with a row behind each new criterion of Segments (a member of both segments the test builds). */
  collector: string;
  /** The 15 new criteria of Segments, each naming `collector`'s own values (`collectorRules`). */
  rules: Record<string, unknown>[];
  /** Raw views written. */
  views: number;
  /** Paris days counted by the views' job. */
  days: number;
}

/** 80 slots: the pages of a visit in their proportions (1 in 80 a SCAN), as scripts/views-size.ts writes them. */
const PAGE_MIX: number[] = [
  ...Array<number>(1).fill(VIEW_PAGE_CODES.SCAN),
  ...Array<number>(16).fill(VIEW_PAGE_CODES.NOW),
  ...Array<number>(10).fill(VIEW_PAGE_CODES.COLLECTION),
  ...Array<number>(24).fill(VIEW_PAGE_CODES.MODEL),
  ...Array<number>(4).fill(VIEW_PAGE_CODES.RELEASES),
  ...Array<number>(8).fill(VIEW_PAGE_CODES.RELEASE),
  ...Array<number>(6).fill(VIEW_PAGE_CODES.MY_PIECES),
  ...Array<number>(3).fill(VIEW_PAGE_CODES.PIECE),
  ...Array<number>(3).fill(VIEW_PAGE_CODES.CLUB),
  ...Array<number>(2).fill(VIEW_PAGE_CODES.CIRCLE),
  ...Array<number>(2).fill(VIEW_PAGE_CODES.ACCOUNT),
  ...Array<number>(1).fill(VIEW_PAGE_CODES.RESULT),
];
const VIEW_CHUNK = 100_000;

const ints = (values: readonly number[]) => sql.raw(`ARRAY[${values.join(',')}]::int[]`);
const smallints = (values: readonly number[]) => sql.raw(`ARRAY[${values.join(',')}]::smallint[]`);
const uuids = (values: readonly string[]) => sql.raw(`ARRAY[${values.map((v) => `'${v}'`).join(',')}]::uuid[]`);
const texts = (values: readonly string[]) => sql.raw(`ARRAY[${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(',')}]::text[]`);

export async function seedInsightsHouse(db: Db, o: { scale?: number; log?: (m: string) => void } = {}): Promise<PerfHouse> {
  const scale = o.scale ?? 1;
  const log = o.log ?? (() => {});
  const n = (x: number) => Math.max(1, Math.round(x * scale));
  const N = n(PERF_HOUSE.collectors);
  const T = n(PERF_HOUSE.testAccounts);
  const X = n(PERF_HOUSE.deleted);
  const now = PERF_NOW;
  const count = async (table: string) => Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(table)}`.execute(db)).rows[0]!.n);
  await sql`SELECT setseed(0.42)`.execute(db);

  // The Paris days of the recording: its first day (13 Paris months before now) to yesterday.
  const cutoff = viewHistoryCutoff(now);
  const firstDay = parisDay(cutoff);
  const today = parisDay(now);
  const days: { d: number; day: string; start: Date }[] = [];
  for (let day = firstDay, d = 0; day < today; day = nextParisDay(day), d++) days.push({ d, day, start: parisDayStart(day) });
  const D = days.length;
  const start = days[0]!.start;
  const todayStart = parisDayStart(today);
  await sql`CREATE TEMP TABLE perf_days (d int PRIMARY KEY, day date NOT NULL, start timestamptz NOT NULL)`.execute(db);
  await sql`INSERT INTO perf_days (d, day, start)
            SELECT * FROM unnest(${ints(days.map((x) => x.d))}, ${sql.raw(`ARRAY[${days.map((x) => `'${x.day}'`).join(',')}]::date[]`)},
                                 ${sql.raw(`ARRAY[${days.map((x) => `'${x.start.toISOString()}'`).join(',')}]::timestamptz[]`)})`.execute(db);
  log(`days: ${D}, ${firstDay} to ${days[D - 1]!.day}`);

  // ── The catalogue: 3 collections, 24 main models (8 each), 8 variants of the first four; 13 monthly draws ──
  const w = await new GrowthWorld(db).prepare();
  const collections: string[] = [];
  for (const name of ['PERF CELESTE', 'PERF ORBITE', 'PERF ECLIPSE']) collections.push((await db.insertInto('collections').values({ name }).returning('id').executeTakeFirstOrThrow()).id);
  const mainModels: string[] = [];
  for (let i = 0; i < 24; i++) mainModels.push(await w.model(`PERF MODEL ${i + 1}`, { price: [20_000 + 5_000 * (i % 6), 'EUR'], collectionId: collections[i % 3]!, ...(i < 4 ? { label: 'Silver', swatch: '#C0C0C0' } : {}) }));
  const variants: string[] = [];
  for (let i = 0; i < 8; i++) variants.push(await w.model(`PERF MODEL ${(i % 4) + 1}`, { variantOf: mainModels[i % 4]!, label: ['Blue', 'Black'][Math.floor(i / 4)]!, swatch: ['#1F3A8A', '#111111'][Math.floor(i / 4)]!, collectionId: collections[(i % 4) % 3]! }));
  const models = [...mainModels, ...variants];
  const months = [...new Set(days.map((x) => x.day.slice(0, 7)))];
  const drops: string[] = [];
  for (const m of months) drops.push((await w.drop({ mode: 'DRAW', modelId: mainModels[drops.length % 24]!, title: `PERF DRAW ${m}`, opens: `${m}-02`, quantity: 50 })).id);

  // ── The acquisition's first boot (channels, DIRECT, BEFORE, STAFF), 30 links, 40 sites, 300 campaigns ──
  await new AcquisitionService({ db, publicOrigin: 'https://verify.orbes.bench', clock: () => start }).prepare();
  await db.updateTable('acquisition_state').set({ tracking_started_at: start, conversions_until: start, daily_until: null, catch_up_on: null }).where('id', '=', 1).execute();
  const admin = (await db.insertInto('admin_users').values({ email: 'perf-admin@orbes.bench', email_normalized: 'perf-admin@orbes.bench', password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow()).id;
  await sql`
    INSERT INTO links (code, name, channel_id, destination, cost_minor, cost_currency, created_by, created_at, updated_at, archived_at, archived_by)
    SELECT 'perf-link-' || g, 'Perf link ' || g, c.id, 'NOW', CASE WHEN g % 3 = 0 THEN 5000 * g END, CASE WHEN g % 3 = 0 THEN 'EUR' END, ${admin}::uuid,
           ${start}::timestamptz, ${start}::timestamptz, CASE WHEN g % 10 = 0 THEN ${now}::timestamptz - interval '30 days' END, CASE WHEN g % 10 = 0 THEN ${admin}::uuid END
      FROM generate_series(1, ${PERF_HOUSE.links}::int) g
      JOIN (SELECT id, row_number() OVER (ORDER BY position) - 1 AS n FROM link_channels) c ON c.n = g % 7`.execute(db);
  await sql`INSERT INTO acquisition_sources (kind, link_id, key, created_at) SELECT 'LINK', id, 'L:' || id, created_at FROM links WHERE code LIKE 'perf-link-%'`.execute(db);
  await sql`INSERT INTO acquisition_sources (kind, site, key, created_at)
            SELECT 'SITE', 'perf-site-' || g || '.example', 'S:perf-site-' || g || '.example', ${start}::timestamptz FROM generate_series(1, ${PERF_HOUSE.sites}::int) g`.execute(db);
  await sql`INSERT INTO acquisition_sources (kind, utm_source, utm_medium, utm_campaign, key, created_at)
            SELECT 'CAMPAIGN', (ARRAY['instagram','tiktok','newsletter','google'])[1 + g % 4], (ARRAY['story','bio','paid'])[1 + g % 3], 'perf-' || g,
                   'C:' || (ARRAY['instagram','tiktok','newsletter','google'])[1 + g % 4] || chr(31) || (ARRAY['story','bio','paid'])[1 + g % 3] || chr(31) || 'perf-' || g || chr(31) || chr(31),
                   ${start}::timestamptz + (g % ${D}) * interval '1 day'
              FROM generate_series(1, ${PERF_HOUSE.campaigns}::int) g`.execute(db);
  const direct = (await db.selectFrom('acquisition_sources').select('id').where('key', '=', 'DIRECT').executeTakeFirstOrThrow()).id;
  const pool = (await db.selectFrom('acquisition_sources').select('id').where('kind', 'in', ['LINK', 'SITE', 'CAMPAIGN']).orderBy('id').execute()).map((r) => r.id);
  const P = pool.length;
  /** A source for the slot `k`: Direct one time in two, else one of the pool (links six in ten). */
  const source = (k: string) => sql.raw(`(CASE WHEN (${k}) % 2 = 0 THEN ${direct} ELSE (${`ARRAY[${pool.join(',')}]::int[]`})[1 + ((${k})::bigint * 104729 % ${P})::int] END)`);

  // ── The accounts ──
  const created = (k: string) =>
    sql.raw(`(CASE WHEN (${k}) % 5 < 2 THEN '${start.toISOString()}'::timestamptz - (1 + (${k}) % 360) * interval '1 day' - ((${k}) % 1440) * interval '1 minute'
                   ELSE (SELECT pd.start FROM perf_days pd WHERE pd.d = (${k}) % ${D}) + ((${k}) * 137 % 86000) * interval '1 second' END)`);
  await sql`
    INSERT INTO accounts (email, email_normalized, password_hash, country, status, created_at)
    SELECT e, e, 'unused', CASE WHEN g % 20 = 19 THEN NULL ELSE (ARRAY['FR','GB','US','IT','DE','ES','CH','BE','JP','AE'])[1 + (g * 7) % 10] END,
           CASE WHEN g % 200 = 0 THEN 'LOCKED' ELSE 'ACTIVE' END, ${created('g')}
      FROM generate_series(1, ${N}::int) g, LATERAL (SELECT 'perf-c-' || g || '@bench.test' AS e) x`.execute(db);
  await sql`
    INSERT INTO accounts (email, email_normalized, password_hash, country, created_at)
    SELECT 'perf-t-' || g || '@bench.test', 'perf-t-' || g || '@bench.test', 'unused', 'FR', ${created('(g * 5 + 2)')}
      FROM generate_series(1, ${T}::int) g`.execute(db);
  await sql`INSERT INTO test_entrants (account_id, tier, seniority) SELECT id, (row_number() OVER (ORDER BY email) % 4)::smallint, 0 FROM accounts WHERE email LIKE 'perf-t-%'`.execute(db);
  await sql`
    INSERT INTO accounts (email, email_normalized, password_hash, country, status, created_at)
    SELECT 'perf-d-' || g || '@bench.test', 'perf-d-' || g || '@bench.test', 'unused', 'FR', 'DELETED', ${created('(g * 11 + 3)')}
      FROM generate_series(1, ${X}::int) g`.execute(db);
  for (let i = 1; i <= PERF_HOUSE.team; i++) {
    const e = `perf-team-${i}@orbes.bench`;
    await db.insertInto('accounts').values({ email: e, email_normalized: e, password_hash: 'unused', country: 'FR', created_at: start }).execute();
    await db.insertInto('admin_users').values({ email: e, email_normalized: e, password_hash: 'scrypt$x', role: 'OPERATOR' }).execute();
  }
  // Every account of the house numbered: k is the counted collectors' 1..N (the others after them).
  await sql`
    CREATE TEMP TABLE perf_acc AS
    SELECT id, created_at, row_number() OVER (ORDER BY (email NOT LIKE 'perf-c-%'), length(email), email)::int AS k, email LIKE 'perf-c-%' AS counted
      FROM accounts WHERE email LIKE 'perf-%'`.execute(db);
  await sql`CREATE UNIQUE INDEX ON perf_acc (k)`.execute(db);
  await sql`CREATE UNIQUE INDEX ON perf_acc (id)`.execute(db);
  log(`accounts: ${await count('perf_acc')}`);

  // ── Profiles, tastes, wishes, tags ──
  await sql`
    INSERT INTO heard_options (label, is_other, position)
    SELECT v.label, v.label = 'Other', v.position FROM (VALUES ('Instagram', 1), ('A friend', 2), ('A shop', 3), ('The press', 4), ('TikTok', 5), ('Other', 6)) v (label, position)
     WHERE NOT EXISTS (SELECT 1 FROM heard_options)`.execute(db);
  const heardOptions = (await db.selectFrom('heard_options').select('id').orderBy('position').execute()).map((r) => r.id);
  const cities: string[] = [];
  for (let i = 0; i < PERF_HOUSE.cities; i++) {
    const c = i === 0 ? 'Saint-Étienne' : i === 1 ? 'Lyon' : `Perf City ${i}`;
    cities.push(c, c.toLowerCase(), c.toUpperCase());
  }
  await sql`
    INSERT INTO account_profiles (account_id, first_name, last_name, birth_date, birth_date_by, birth_date_at, city, heard_option_id, heard_other, heard_at, created_at, updated_at)
    SELECT a.id, 'Perf', 'Collector ' || a.k,
           CASE WHEN a.k % 10 < 7 THEN DATE '1950-01-01' + (a.k * 7919 % 20000) END,
           CASE WHEN a.k % 10 < 7 THEN 'COLLECTOR' END, CASE WHEN a.k % 10 < 7 THEN a.created_at END,
           CASE WHEN a.k % 10 < 6 THEN (${texts(cities)})[1 + (power(((a.k * 2654435761::bigint) % 1000) / 1000.0, 2) * ${cities.length})::int % ${cities.length}] END,
           CASE WHEN a.k % 2 = 0 THEN (${uuids(heardOptions)})[1 + (a.k / 2) % ${heardOptions.length}] END,
           CASE WHEN a.k % 2 = 0 AND (a.k / 2) % ${heardOptions.length} = ${heardOptions.length - 1} THEN 'A podcast' END,
           CASE WHEN a.k % 2 = 0 THEN a.created_at END, a.created_at, a.created_at
      FROM perf_acc a`.execute(db);
  const pieces = ['Rings', 'Bracelets', 'Necklaces', 'Earrings', 'Watches'];
  const finishes = ['Silver', 'Gold', 'Black', 'Rose'];
  await sql`
    INSERT INTO account_tastes (account_id, kind, value_key, label, created_at)
    SELECT a.id, 'PIECE', upper(p.label), p.label, a.created_at
      FROM perf_acc a JOIN LATERAL (SELECT (${texts(pieces)})[1 + (a.k + j) % 5] AS label FROM generate_series(0, a.k % 3 - 1) j) p ON true
     WHERE a.k % 10 < 7
    ON CONFLICT DO NOTHING`.execute(db);
  await sql`
    INSERT INTO account_tastes (account_id, kind, value_key, label, created_at)
    SELECT a.id, 'FINISH', upper((${texts(finishes)})[1 + a.k % 4]), (${texts(finishes)})[1 + a.k % 4], a.created_at FROM perf_acc a WHERE a.k % 2 = 1`.execute(db);
  await sql`
    INSERT INTO account_wishes (account_id, model_id, added_at, removed_at)
    SELECT a.id, (${uuids(models)})[1 + (a.k * 7 + j * 13) % ${models.length}],
           greatest(a.created_at, ${start}::timestamptz) + ((a.k * 31 + j * 997) % 1000) * (${now}::timestamptz - greatest(a.created_at, ${start}::timestamptz)) / 1000,
           NULL
      FROM perf_acc a CROSS JOIN LATERAL generate_series(0, a.k % 3) j
     WHERE a.k % 10 < 6
    ON CONFLICT DO NOTHING`.execute(db);
  // One wish in four removed since (its added_at moved earlier, its removal halfway to now).
  await sql`UPDATE account_wishes SET removed_at = added_at + (${now}::timestamptz - added_at) / 2 WHERE abs(hashtext(account_id::text || model_id::text)) % 4 = 0`.execute(db);
  await sql`
    INSERT INTO account_tags (account_id, tag, created_by, created_at)
    SELECT a.id, (ARRAY['VIP','PRESS','RETAIL','FRIEND','COLLECTOR'])[1 + (a.k + j) % 5], ${admin}::uuid, ${now}::timestamptz - (a.k % 300) * interval '1 day'
      FROM perf_acc a CROSS JOIN generate_series(0, 1) j WHERE a.k % 10 = 3 AND (j = 0 OR a.k % 20 = 3)`.execute(db);
  log(`profiles: ${await count('account_profiles')}, tastes: ${await count('account_tastes')}, wishes: ${await count('account_wishes')}`);

  // ── Places and devices ──
  await sql`INSERT INTO geo_places (country, city)
            SELECT (ARRAY['FR','GB','US','IT','DE','ES','CH','BE','JP','AE'])[1 + g % 10], CASE WHEN g <= 10 THEN NULL ELSE 'Perf Place ' || g END
              FROM generate_series(1, ${PERF_HOUSE.places}::int) g ON CONFLICT DO NOTHING`.execute(db);
  const placeFirst = Number((await sql<{ m: number }>`SELECT min(id) AS m FROM geo_places WHERE city LIKE 'Perf Place %' OR city IS NULL`.execute(db)).rows[0]!.m);
  const hash = (seed: string) => sql.raw(`translate(substr(encode(sha256(convert_to(${seed}, 'UTF8')), 'base64'), 1, 43), '+/', '-_')`);
  const deviceClass = (k: string) =>
    sql.raw(`(ARRAY['PHONE','PHONE','PHONE','COMPUTER','TABLET'])[1 + (${k}) % 5], (ARRAY['IOS','IOS','ANDROID','MACOS','WINDOWS'])[1 + (${k}) % 5],
             (ARRAY['SAFARI','SAFARI','CHROME','CHROME','FIREFOX'])[1 + (${k}) % 5], CASE WHEN (${k}) % 7 = 0 THEN 'IN_APP' WHEN (${k}) % 11 = 0 THEN 'HOME_SCREEN' ELSE 'BROWSER' END,
             CASE WHEN (${k}) % 7 = 0 THEN 'INSTAGRAM' END`);
  // Each account's device (first seen at its creation, or on a day of the recording for an account made before it), a
  // second for one counted collector in three; then the anonymous devices, a share of each day.
  await sql`
    INSERT INTO tracking_devices (device_hash, kind, os, browser, opened_in, in_app, account_id, linked_at, last_place_id, first_seen_at, last_seen_at, first_source_id)
    SELECT ${hash(`'perf-dev-' || x.k || '-' || x.j`)}, ${deviceClass('x.k + x.j')}, x.id, x.seen, ${placeFirst} + (x.k * 3 + x.j) % ${PERF_HOUSE.places},
           x.seen, least(x.seen + ((x.k % 200) + 1) * interval '1 day', ${todayStart}::timestamptz), ${source('x.k + x.j')}
      FROM (SELECT a.k, j, a.id,
                   CASE WHEN j = 0 AND a.created_at >= ${start}::timestamptz THEN a.created_at - interval '10 minutes'
                        ELSE (SELECT pd.start FROM perf_days pd WHERE pd.d = (a.k * 7 + j * 101) % ${D}) + (a.k % 1440) * interval '1 minute' END AS seen
              FROM perf_acc a CROSS JOIN generate_series(0, 1) j
             WHERE j = 0 OR (a.counted AND a.k % 3 = 0)) x
     ORDER BY x.seen`.execute(db);
  await sql`
    INSERT INTO tracking_devices (device_hash, kind, os, browser, opened_in, in_app, last_place_id, first_seen_at, last_seen_at, first_source_id)
    SELECT ${hash(`'perf-anon-' || g`)}, ${deviceClass('g')}, ${placeFirst} + g % ${PERF_HOUSE.places},
           pd.start + (g % 1440) * interval '1 minute', pd.start + (g % 1440) * interval '1 minute' + interval '1 hour', ${source('g')}
      FROM generate_series(1, ${n(PERF_HOUSE.anonymousDevices)}::int) g JOIN perf_days pd ON pd.d = g % ${D}
     ORDER BY pd.d, g`.execute(db);
  await sql`
    INSERT INTO tracking_device_accounts (device_id, account_id, first_via, first_linked_at, last_linked_at, links)
    SELECT d.id, d.account_id, CASE WHEN d.first_seen_at < a.created_at THEN 'SIGN_UP' ELSE 'SIGN_IN' END, d.linked_at, d.last_seen_at, 1 + a.k % 4
      FROM tracking_devices d JOIN perf_acc a ON a.id = d.account_id`.execute(db);
  // One visit per device first seen through a source, its account's when linked.
  await sql`
    INSERT INTO acquisition_touches (device_id, source_id, day, first_at, last_at, arrivals, account_id)
    SELECT d.id, d.first_source_id, pd.day, d.first_seen_at, d.first_seen_at + interval '5 minutes', 1 + d.id % 3, d.account_id
      FROM tracking_devices d CROSS JOIN LATERAL (SELECT p.day FROM perf_days p WHERE p.start <= d.first_seen_at ORDER BY p.d DESC LIMIT 1) pd
     WHERE d.first_source_id <> ${direct}::integer`.execute(db);
  // The accounts made since the recording started: their first source (their first device's) and their sign-up.
  await sql`
    INSERT INTO account_sources (account_id, first_source_id, first_seen_at, set_at, set_by)
    SELECT DISTINCT ON (d.account_id) d.account_id, d.first_source_id, d.first_seen_at, a.created_at, 'SIGN_UP'
      FROM tracking_devices d JOIN perf_acc a ON a.id = d.account_id
     WHERE a.created_at >= ${start}::timestamptz ORDER BY d.account_id, d.first_seen_at`.execute(db);
  await sql`
    INSERT INTO acquisition_conversions (kind, ref_id, account_id, at, last_source_id, created_at)
    SELECT 'SIGNUP', a.id, a.id, a.created_at, CASE WHEN a.k % 10 < 7 THEN s.first_source_id ELSE (${ints(pool)})[1 + (a.k * 31) % ${P}] END, a.created_at
      FROM perf_acc a JOIN account_sources s ON s.account_id = a.id`.execute(db);
  log(`devices: ${await count('tracking_devices')}, visits: ${await count('acquisition_touches')}, first sources: ${await count('account_sources')}`);

  // ── The raw views: in time order over the 13 months, one device per visit of 8 rows ──
  const V = n(PERF_HOUSE.views);
  const span = (todayStart.getTime() - start.getTime()) / 1000;
  await sql`CREATE TEMP TABLE perf_dev AS SELECT row_number() OVER (ORDER BY id)::int AS i, id, account_id, last_place_id FROM tracking_devices`.execute(db);
  await sql`CREATE UNIQUE INDEX ON perf_dev (i)`.execute(db);
  const DV = await count('perf_dev');
  const releasePages = [VIEW_PAGE_CODES.RELEASE];
  for (let from = 0; from < V; from += VIEW_CHUNK) {
    const to = Math.min(V, from + VIEW_CHUNK) - 1;
    await sql`
      INSERT INTO collector_views (at, device_id, account_id, page, subject, seconds, place_id)
      SELECT ${start}::timestamptz + make_interval(secs => ((s.g::double precision + random() * 0.9) * ${span} / ${V})),
             d.id, CASE WHEN s.g % 8 <> 7 THEN d.account_id END, s.pg,
             CASE WHEN s.pg IN (${VIEW_PAGE_CODES.MODEL}, ${VIEW_PAGE_CODES.SCAN}, ${VIEW_PAGE_CODES.PIECE}) THEN (${uuids(models)})[1 + (s.g * 7 + d.i) % ${models.length}]
                  WHEN s.pg IN (${sql.join(releasePages)}) THEN (${uuids(drops)})[1 + (s.g + d.i) % ${drops.length}] END,
             CASE WHEN s.pg = ${VIEW_PAGE_CODES.SCAN} THEN 0 ELSE 1 + floor(power(random(), 2) * 300)::int END,
             d.last_place_id
        FROM (SELECT g, 1 + ((g / 8)::bigint * 2654435761 % ${DV})::int AS dv, (${smallints(PAGE_MIX)})[1 + (g * 37) % 80] AS pg
                FROM generate_series(${from}::int, ${to}::int) g) s
        JOIN perf_dev d ON d.i = s.dv`.execute(db);
    log(`views: ${to + 1} / ${V}`);
  }
  await sql`DROP TABLE perf_dev`.execute(db);
  await db.insertInto('tracking_state').values({ id: 1, started_at: start, scans_backfilled_at: start }).onConflict((oc) => oc.column('id').doUpdateSet({ started_at: start, scans_backfilled_at: start })).execute();
  await sql`ANALYZE collector_views`.execute(db);
  const counted = await aggregateViews(db, now, { maxDays: 1_000 });
  log(`views counted: ${counted.days} days, ${counted.months} months`);

  // ── Pieces held: one each for half the collectors, five more for one in fifty, ten more for one in two hundred ──
  const holders = sql.raw(`(SELECT k, id, created_at FROM perf_acc WHERE counted)`);
  await sql`CREATE TEMP TABLE perf_hold AS
            SELECT row_number() OVER (ORDER BY h.k, j)::int AS s, h.id AS account_id, h.created_at
              FROM ${holders} h CROSS JOIN LATERAL generate_series(1, CASE WHEN h.k % 200 = 1 THEN 16 WHEN h.k % 50 = 1 THEN 6 ELSE 1 END) j
             WHERE h.k % 2 = 1 OR h.k % 50 = 1`.execute(db);
  const category = (await db.selectFrom('categories').select('id').where('code', '=', 'J').executeTakeFirstOrThrow()).id;
  const serialBase = Number((await sql<{ m: number | null }>`SELECT max(serial) AS m FROM products WHERE category_id = ${category} AND year = 2025`.execute(db)).rows[0]!.m ?? 0);
  await sql`
    INSERT INTO products (product_id, packed_identity, year, category_id, serial, sku, model_id, material, status, ownership_state)
    SELECT 'O25-J-' || lpad((${serialBase} + h.s)::text, 5, '0'), ((25::bigint << 25) | (${category}::bigint << 20) | (${serialBase} + h.s)), 2025, ${category}, ${serialBase} + h.s,
           'PERF-' || h.s, (${uuids(models)})[1 + h.s % ${models.length}], '925 STERLING SILVER', 'OWNED', 'OWNED'
      FROM perf_hold h`.execute(db);
  await sql`
    INSERT INTO ownership (product_id, account_id, acquired_via, started_at)
    SELECT p.id, h.account_id, CASE WHEN h.s % 10 < 7 THEN 'FIRST_REGISTRATION' WHEN h.s % 10 < 9 THEN 'TRANSFER' ELSE 'ADMIN' END,
           greatest(h.created_at, ${now}::timestamptz - (h.s % 700) * interval '1 day') + interval '1 hour'
      FROM perf_hold h JOIN products p ON p.sku = 'PERF-' || h.s`.execute(db);
  // The paid orders of the private salon, on the first pieces held; one in twenty cancelled with its credit note.
  const ordersN = n(PERF_HOUSE.orders);
  await sql`
    INSERT INTO shop_requests (account_id, model_id, note, status, created_at, handled_at, outcome)
    SELECT w.account_id, p.model_id, p.sku, 'CLOSED', w.started_at - interval '2 hours', w.started_at - interval '1 hour', 'ACCEPTED'
      FROM ownership w JOIN products p ON p.id = w.product_id JOIN perf_hold h ON p.sku = 'PERF-' || h.s
     WHERE h.s <= ${ordersN}`.execute(db);
  await sql`
    INSERT INTO orders (channel, account_id, model_id, shop_request_id, price_minor, currency, status, reserved_at, paid_at, cancelled_at, location_id, product_id)
    SELECT 'SALON', r.account_id, r.model_id, r.id, 20000 + (abs(hashtext(r.note)) % 6) * 5000, CASE WHEN abs(hashtext(r.note)) % 10 = 0 THEN 'GBP' ELSE 'EUR' END,
           CASE WHEN abs(hashtext(r.note)) % 20 = 1 THEN 'CANCELLED' ELSE 'PAID' END, r.handled_at, r.handled_at + interval '30 minutes',
           CASE WHEN abs(hashtext(r.note)) % 20 = 1 THEN r.handled_at + interval '1 day' END, ${w.location}::uuid,
           CASE WHEN abs(hashtext(r.note)) % 20 = 1 THEN NULL ELSE p.id END
      FROM shop_requests r JOIN products p ON p.sku = r.note WHERE r.note LIKE 'PERF-%'`.execute(db);
  const lines = JSON.stringify([{ kind: 'PIECE', label: 'PIECE', detail: 'THE PRIVATE SALON', amountMinor: 0 }]);
  const seqBase = Number((await sql<{ m: number | null }>`SELECT max(sequence) AS m FROM invoices`.execute(db)).rows[0]!.m ?? 0);
  await sql`
    INSERT INTO invoices (kind, year, sequence, order_id, issuer, buyer, lines, currency, subtotal_minor, total_minor, issued_at)
    SELECT 'INVOICE', extract(year FROM o.paid_at AT TIME ZONE 'UTC')::int, ${seqBase} + row_number() OVER (ORDER BY o.id), o.id, '{"name":"CONGLOMERAT LLC"}', '{}', ${lines}::jsonb,
           o.currency, o.price_minor, o.price_minor, o.paid_at
      FROM orders o JOIN shop_requests r ON r.id = o.shop_request_id WHERE r.note LIKE 'PERF-%'`.execute(db);
  await sql`
    INSERT INTO invoices (kind, year, sequence, order_id, credits_invoice_id, credit_scope, issuer, buyer, lines, currency, subtotal_minor, total_minor, issued_at)
    SELECT 'CREDIT_NOTE', extract(year FROM o.cancelled_at AT TIME ZONE 'UTC')::int, ${seqBase} + 900000 + row_number() OVER (ORDER BY o.id), o.id, i.id, 'FULL', i.issuer, i.buyer, i.lines,
           i.currency, i.subtotal_minor, i.total_minor, o.cancelled_at
      FROM orders o JOIN invoices i ON i.order_id = o.id AND i.kind = 'INVOICE' JOIN shop_requests r ON r.id = o.shop_request_id
     WHERE o.status = 'CANCELLED' AND r.note LIKE 'PERF-%'`.execute(db);
  await sql`
    INSERT INTO acquisition_conversions (kind, ref_id, account_id, at, last_source_id, created_at)
    SELECT 'ORDER', o.id, o.account_id, o.reserved_at, CASE WHEN abs(hashtext(o.id::text)) % 2 = 0 THEN s.first_source_id ELSE (${ints(pool)})[1 + abs(hashtext(o.id::text)) % ${P}] END, o.reserved_at
      FROM orders o JOIN shop_requests r ON r.id = o.shop_request_id JOIN account_sources s ON s.account_id = o.account_id
     WHERE r.note LIKE 'PERF-%' AND o.reserved_at >= ${start}::timestamptz`.execute(db);
  await sql`DROP TABLE perf_hold`.execute(db);
  log(`pieces held: ${await count('ownership')}, orders: ${await count('orders')}`);

  // ── Draw entries, scans, sign-ins ──
  const monthIndex = texts(months);
  await sql`
    INSERT INTO drop_entries (drop_id, account_id, created_at, status)
    SELECT (${uuids(drops)})[array_position(${monthIndex}, to_char(pd.day, 'YYYY-MM'))], a.id, pd.start + (g % 1000) * interval '1 minute', 'ENTERED'
      FROM generate_series(1, ${n(PERF_HOUSE.entries)}::int) g
      JOIN perf_days pd ON pd.d = (g * 13) % ${D}
      JOIN perf_acc a ON a.k = 1 + (g::bigint * 7919 % ${N})::int
    ON CONFLICT (drop_id, account_id) DO NOTHING`.execute(db);
  await sql`
    INSERT INTO acquisition_conversions (kind, ref_id, account_id, at, last_source_id, created_at)
    SELECT 'DRAW_ENTRY', e.id, e.account_id, e.created_at, CASE WHEN abs(hashtext(e.id::text)) % 2 = 0 THEN s.first_source_id ELSE (${ints(pool)})[1 + abs(hashtext(e.id::text)) % ${P}] END, e.created_at
      FROM drop_entries e JOIN account_sources s ON s.account_id = e.account_id WHERE e.drop_id = ANY(${uuids(drops)})`.execute(db);
  await sql`
    INSERT INTO scan_events (occurred_at, event_type, account_id, country, result_state)
    SELECT pd.start + (g % 1440) * interval '1 minute', 'VERIFY', a.id, 'FR', 'AUTHENTIC'
      FROM generate_series(1, ${n(PERF_HOUSE.scans)}::int) g
      JOIN perf_days pd ON pd.d = (g * 17) % ${D}
      JOIN perf_acc a ON a.k = 1 + (g::bigint * 104729 % ${N + T})::int`.execute(db);
  await sql`
    INSERT INTO audit_logs (occurred_at, actor_type, actor_id, action, target_type, target_id, details, prev_hash, hash)
    SELECT pd.start + (g % 1440) * interval '1 minute', 'account', a.id::text, 'account.login', 'account', a.id::text, '{}'::jsonb,
           sha256(convert_to('perf-login-prev-' || g, 'UTF8')), sha256(convert_to('perf-login-' || g, 'UTF8'))
      FROM generate_series(1, ${n(PERF_HOUSE.logins)}::int) g
      JOIN perf_days pd ON pd.d = (g * 29) % ${D}
      JOIN perf_acc a ON a.k = 1 + (power(((g::bigint * 2654435761) % 100000) / 100000.0, 1.5) * ${N + T})::int % ${N + T}`.execute(db);
  log(`entries: ${await count('drop_entries')}, scans: ${await count('scan_events')}, sign-ins: ${await count('audit_logs')}`);

  // ── The acquisition's days summarised by its job ──
  for (let k = await summariseDays(db, now, { maxDays: 1_000 }); k > 0; k = await summariseDays(db, now, { maxDays: 1_000 }));
  await db.updateTable('acquisition_state').set({ conversions_until: now, catch_up_on: parisDay(new Date(now.getTime() - 86_400_000)) }).where('id', '=', 1).execute();

  // ── This morning's scores and the monthly history ──
  await sql`
    INSERT INTO account_scores (account_id, formula, score, recency_points, frequency_points, spend_points, speed_points, attendance_points,
                                last_act_at, last_act_kind, active_days, spend_eur_minor, purchases, unpriced, other_currencies,
                                speed_minutes, speed_releases, releases_taken, releases_open, changed_at)
    SELECT a.id, 1, (p.r + p.f + p.s + p.v + p.t)::smallint, p.r, p.f, p.s, p.v, p.t,
           ${now}::timestamptz - (a.k % 100) * interval '1 day', 'SCAN', (a.k % 200)::smallint, p.s * 1000, (a.k % 4)::smallint, 0, '{}'::text[],
           CASE WHEN p.v > 0 THEN 30 + a.k % 600 END, (p.v > 0)::int::smallint, (a.k % 3)::smallint, 3, ${now}::timestamptz - interval '3 hours'
      FROM perf_acc a JOIN accounts ac ON ac.id = a.id
      CROSS JOIN LATERAL (SELECT (a.k % 26)::smallint AS r, ((a.k * 3) % 21)::smallint AS f, ((a.k * 7) % 26)::smallint AS s,
                                 ((a.k * 11) % 11)::smallint AS v, ((a.k * 13) % 21)::smallint AS t) p
     WHERE a.counted AND ac.status <> 'DELETED' AND a.k % 10 <> 9`.execute(db);
  const bands = (await sql<{ b: number; n: number }>`SELECT least(score / 10, 9)::int AS b, count(*)::int AS n FROM account_scores GROUP BY 1`.execute(db)).rows;
  const bandArray = Array.from({ length: 10 }, (_, b) => bands.find((r) => r.b === b)?.n ?? 0);
  await db
    .insertInto('engagement_runs')
    .values({ day: today, formula: 1, started_at: new Date(now.getTime() - 3 * 3_600_000), finished_at: new Date(now.getTime() - 3 * 3_600_000 + 60_000), accounts: await count('account_scores'), changed: 0, bands: bandArray, duration_ms: 60_000 })
    .execute();
  const lastMonth = parisDay(parisMonthStart(new Date(parisMonthStart(now).getTime() - 86_400_000)));
  const earliest = (() => {
    const [y, m] = lastMonth.split('-').map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 1 - 11, 1));
    return d.toISOString().slice(0, 10);
  })();
  await sql`
    INSERT INTO collector_history (account_id, first_month, scores, tiers, active, last_month)
    SELECT x.id, x.first, (SELECT array_agg(((x.k + i * 7) % 101)::smallint ORDER BY i) FROM generate_series(0, x.len - 1) i),
           (SELECT array_agg((CASE WHEN x.k % 200 = 1 THEN 3 WHEN x.k % 50 = 1 THEN 2 WHEN x.k % 2 = 1 THEN 1 ELSE 0 END)::smallint ORDER BY i) FROM generate_series(0, x.len - 1) i),
           (SELECT array_agg((x.k + i) % 3 <> 0 ORDER BY i) FROM generate_series(0, x.len - 1) i), ${lastMonth}::date
      FROM (SELECT a.id, a.k, f.first, (12 * (extract(year FROM ${lastMonth}::date) - extract(year FROM f.first)) + extract(month FROM ${lastMonth}::date) - extract(month FROM f.first))::int + 1 AS len
              FROM perf_acc a JOIN accounts ac ON ac.id = a.id
              CROSS JOIN LATERAL (SELECT greatest(${earliest}::date, date_trunc('month', a.created_at AT TIME ZONE 'UTC')::date) AS first) f
             WHERE a.counted AND ac.status <> 'DELETED') x
     WHERE x.len >= 1`.execute(db);
  log(`scores: ${await count('account_scores')}, history: ${await count('collector_history')}`);

  const collector = await pickCollector(db, heardOptions);
  const rules = await collectorRules(db, collector, now);
  const links = (await db.selectFrom('links').select('id').where('code', 'like', 'perf-link-%').orderBy('code').execute()).map((r) => r.id);
  const channels = (await db.selectFrom('link_channels').select('id').orderBy('position').execute()).map((r) => r.id);
  await sql`DROP TABLE perf_acc`.execute(db);
  await sql`DROP TABLE perf_days`.execute(db);
  // What autovacuum leaves on the box: the visibility map set (index-only scans read no heap) and the statistics.
  await sql`VACUUM ANALYZE`.execute(db);
  return { collectors: N, models, mainModels, collections, drops, links, channels, heardOptions, collector, rules, views: V, days: counted.days };
}

const RELEASE_VIEW_PAGES = [VIEW_PAGE_CODES.RELEASE, VIEW_PAGE_CODES.LIVE, VIEW_PAGE_CODES.AFTER_ROOM];

/**
 * The house's collector: a counted ACTIVE collector with a row behind each of the 15 new criteria (a city, a date of
 * birth, a tag, an open wish, a favourite piece and finish, MODEL and release views, a place, a device, a first source
 * and a sign-up's last source that are links, a score), its MODEL views the most recent of them. The house writes how
 * they heard for even-numbered accounts and tags for odd-numbered ones: the collector's answer is written here when it
 * has none.
 */
async function pickCollector(db: Db, heardOptions: readonly string[]): Promise<string> {
  const id = (
    await sql<{ id: string }>`
      SELECT a.id FROM perf_acc a JOIN accounts ac ON ac.id = a.id
        JOIN account_profiles p ON p.account_id = a.id AND p.city IS NOT NULL AND p.birth_date IS NOT NULL
        JOIN account_sources s ON s.account_id = a.id JOIN acquisition_sources fs ON fs.id = s.first_source_id AND fs.kind = 'LINK'
        JOIN acquisition_conversions c ON c.kind = 'SIGNUP' AND c.ref_id = a.id JOIN acquisition_sources ls ON ls.id = c.last_source_id AND ls.kind = 'LINK'
        JOIN account_scores sc ON sc.account_id = a.id
       WHERE a.counted AND ac.status = 'ACTIVE'
         AND EXISTS (SELECT 1 FROM account_tags t WHERE t.account_id = a.id)
         AND EXISTS (SELECT 1 FROM account_wishes w WHERE w.account_id = a.id AND w.removed_at IS NULL)
         AND EXISTS (SELECT 1 FROM account_tastes t WHERE t.account_id = a.id AND t.kind = 'PIECE')
         AND EXISTS (SELECT 1 FROM account_tastes t WHERE t.account_id = a.id AND t.kind = 'FINISH')
         AND EXISTS (SELECT 1 FROM collector_views v WHERE v.account_id = a.id AND v.page IN (${sql.join(RELEASE_VIEW_PAGES)}))
         AND EXISTS (SELECT 1 FROM collector_places cp WHERE cp.account_id = a.id)
         AND EXISTS (SELECT 1 FROM tracking_device_accounts da JOIN tracking_devices d ON d.id = da.device_id WHERE da.account_id = a.id AND d.staff_at IS NULL)
       ORDER BY (SELECT max(v.at) FROM collector_views v WHERE v.account_id = a.id AND v.page = ${VIEW_PAGE_CODES.MODEL}) DESC NULLS LAST, a.k
       LIMIT 1`.execute(db)
  ).rows[0]?.id;
  if (!id) throw new Error('The house holds no collector with a row behind each new criterion.');
  await sql`UPDATE account_profiles SET heard_option_id = ${heardOptions[1]!}::uuid, heard_at = created_at WHERE account_id = ${id}::uuid AND heard_option_id IS NULL`.execute(db);
  return id;
}

/**
 * The 15 new criteria of Segments (§3.6 C.5.1: PERSON, TASTES, BROWSING, ORIGIN, ENGAGEMENT), each naming the values
 * of `collector`'s own rows, so the collector matches every one: its city, its age, its answer, its tags, an open wish
 * and that model's collection, a favourite piece and finish, its most recent MODEL view's model (as many views as it
 * has over the window) and a release it viewed, its most recent device's kind and system, its latest place's country,
 * its first source's channel and its sign-up's last link, its score's band. A window in days reaches back to its own
 * latest row (30 days at least).
 */
async function collectorRules(db: Db, collector: string, now: Date): Promise<Record<string, unknown>[]> {
  const today = parisDay(now);
  const one = async <T>(q: RawBuilder<T>): Promise<T> => {
    const row = (await q.execute(db)).rows[0];
    if (!row) throw new Error(`The house's collector lacks a row: ${q.compile(db).sql.slice(0, 120)}`);
    return row;
  };
  const days = (d: number) => Math.min(395, Math.max(30, d));
  const person = await one(sql<{ city: string; age: number; heard: string }>`
    SELECT city, extract(year FROM age(${today}::date, birth_date))::int AS age, heard_option_id AS heard FROM account_profiles WHERE account_id = ${collector}::uuid`);
  const tags = (await sql<{ tag: string }>`SELECT tag FROM account_tags WHERE account_id = ${collector}::uuid ORDER BY tag`.execute(db)).rows.map((r) => r.tag);
  const wish = await one(sql<{ model: string; collection: string }>`
    SELECT m.id AS model, m.collection_id AS collection FROM account_wishes w JOIN models m ON m.id = w.model_id
     WHERE w.account_id = ${collector}::uuid AND w.removed_at IS NULL AND m.collection_id IS NOT NULL ORDER BY w.added_at DESC, m.id LIMIT 1`);
  const taste = async (kind: string) =>
    (await one(sql<{ key: string }>`SELECT value_key AS key FROM account_tastes WHERE account_id = ${collector}::uuid AND kind = ${kind} ORDER BY value_key LIMIT 1`)).key;
  const viewed = await one(sql<{ model: string; days: number }>`
    SELECT subject AS model, (${today}::date - (at AT TIME ZONE 'Europe/Paris')::date) + 1 AS days FROM collector_views
     WHERE account_id = ${collector}::uuid AND page = ${VIEW_PAGE_CODES.MODEL} ORDER BY at DESC LIMIT 1`);
  const modelDays = days(viewed.days);
  const modelViews = await one(sql<{ n: number }>`
    SELECT count(*)::int AS n FROM collector_views
     WHERE account_id = ${collector}::uuid AND page = ${VIEW_PAGE_CODES.MODEL} AND at >= ${parisDayStart(addParisDays(today, -(modelDays - 1)))}
       AND subject IN (SELECT id FROM models WHERE id = ${viewed.model}::uuid OR variant_of = ${viewed.model}::uuid)`);
  const release = await one(sql<{ drop: string; n: number }>`
    SELECT subject AS drop, count(*)::int AS n FROM collector_views
     WHERE account_id = ${collector}::uuid AND page IN (${sql.join(RELEASE_VIEW_PAGES)}) AND at >= ${viewHistoryCutoff(now)}
     GROUP BY subject ORDER BY count(*) DESC, subject LIMIT 1`);
  const device = await one(sql<{ kind: string; os: string; days: number }>`
    SELECT d.kind, d.os, (${today}::date - (greatest(da.last_linked_at, CASE WHEN d.account_id = da.account_id THEN d.last_seen_at END) AT TIME ZONE 'Europe/Paris')::date) + 1 AS days
      FROM tracking_device_accounts da JOIN tracking_devices d ON d.id = da.device_id
     WHERE da.account_id = ${collector}::uuid AND d.staff_at IS NULL ORDER BY 3, d.id LIMIT 1`);
  const place = await one(sql<{ country: string; days: number }>`
    SELECT g.country, (${today}::date - cp.last_day) + 1 AS days FROM collector_places cp JOIN geo_places g ON g.id = cp.place_id
     WHERE cp.account_id = ${collector}::uuid ORDER BY cp.last_day DESC, cp.place_id LIMIT 1`);
  const origin = await one(sql<{ channel: string; link: string }>`
    SELECT fl.channel_id AS channel, ls.link_id AS link FROM account_sources s
      JOIN acquisition_sources fs ON fs.id = s.first_source_id JOIN links fl ON fl.id = fs.link_id
      JOIN acquisition_conversions c ON c.kind = 'SIGNUP' AND c.ref_id = s.account_id JOIN acquisition_sources ls ON ls.id = c.last_source_id
     WHERE s.account_id = ${collector}::uuid AND ls.link_id IS NOT NULL`);
  const score = (await one(sql<{ score: number }>`SELECT score FROM account_scores WHERE account_id = ${collector}::uuid`)).score;
  const band = Math.min(90, Math.floor(score / 10) * 10);
  return [
    { kind: 'CITY', cities: [person.city, 'perf city 7'] },
    { kind: 'AGE', min: Math.max(0, person.age - 2), max: Math.min(120, person.age + 2) },
    { kind: 'HEARD_FROM', optionIds: [person.heard] },
    { kind: 'TAGGED', tags },
    { kind: 'WISHES_MODEL', modelIds: [wish.model] },
    { kind: 'WISHES_COLLECTION', collectionIds: [wish.collection] },
    { kind: 'FAVOURITE_PIECE', pieces: [await taste('PIECE')] },
    { kind: 'FAVOURITE_FINISH', finishes: [await taste('FINISH')] },
    { kind: 'VIEWED_MODEL', modelIds: [viewed.model], min: Math.min(100, modelViews.n), days: modelDays },
    { kind: 'VIEWED_RELEASE', dropId: release.drop, min: Math.min(100, release.n) },
    { kind: 'DEVICE', kinds: [device.kind], systems: [device.os], days: days(device.days) },
    { kind: 'PLACE', countries: [place.country], days: days(place.days) },
    { kind: 'FIRST_SOURCE', channelIds: [origin.channel] },
    { kind: 'LAST_SOURCE', linkIds: [origin.link], at: 'EITHER' },
    { kind: 'SCORE', min: band, max: band === 90 ? 100 : band + 9 },
  ];
}

// ── What the test reads and how it times it ──────────────────────────────────────────────────────────────────────

/** §3.6 C.6.8's budget per panel and for a list (cold: the page's own cache empty), and C.5.3's for Segments, in ms. */
export const PERF_BUDGETS_MS = Object.freeze({
  overview: 800,
  who: 600,
  origin: 1_200,
  likes: 2_000,
  devices: 500,
  engagement: 800,
  trends: 2_000,
  list: 500,
  isSegmentMember: 20,
  segmentCount: 1_500,
});

/** The best of `runs` timings of `fn`, in ms, with every timing (the best is compared: another test file's load on a shared runner is not the code's). */
export async function timeBest(fn: () => Promise<unknown>, runs = 3): Promise<{ best: number; all: number[] }> {
  const all: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    all.push(Math.round((performance.now() - t0) * 10) / 10);
  }
  return { best: Math.min(...all), all };
}

/**
 * Every criterion this lot adds to Segments (§3.6 C.5.1: PERSON, TASTES, BROWSING, ORIGIN, ENGAGEMENT, 15 kinds), each
 * naming the house's collector's own values (so it is a member under ALL and under ANY), as one group of `match`.
 */
export function everyNewCriterion(h: PerfHouse, match: 'ALL' | 'ANY'): { match: 'ALL' | 'ANY'; rules: Record<string, unknown>[] } {
  return { match, rules: h.rules };
}

/** One logged statement: its text and parameters, as Kysely's `log` hands them over. */
export interface LoggedQuery {
  sql: string;
  parameters: readonly unknown[];
}

/**
 * The nodes of an EXPLAIN (FORMAT JSON) plan that read `relation`: their node type and index. A Bitmap Heap Scan names
 * no index itself: its index is the one its Bitmap Index Scan reads (the first, under a BitmapAnd or BitmapOr).
 */
export function scansOf(plan: unknown, relation: string): { type: string; index: string | null }[] {
  const out: { type: string; index: string | null }[] = [];
  const childrenOf = (node: Record<string, unknown>) => (node.Plans as Record<string, unknown>[] | undefined) ?? [];
  const bitmapIndex = (node: Record<string, unknown>): string | null => {
    for (const child of childrenOf(node)) {
      if (child['Node Type'] === 'Bitmap Index Scan') return (child['Index Name'] as string | undefined) ?? null;
      if (child['Node Type'] === 'BitmapAnd' || child['Node Type'] === 'BitmapOr') {
        const index = bitmapIndex(child);
        if (index) return index;
      }
    }
    return null;
  };
  const walk = (node: Record<string, unknown>) => {
    if (node['Relation Name'] === relation) {
      const type = String(node['Node Type']);
      out.push({ type, index: (node['Index Name'] as string | undefined) ?? (type === 'Bitmap Heap Scan' ? bitmapIndex(node) : null) });
    }
    for (const child of childrenOf(node)) walk(child);
  };
  const root = Array.isArray(plan) ? (plan[0] as { Plan: Record<string, unknown> }).Plan : (plan as { Plan: Record<string, unknown> }).Plan;
  walk(root);
  return out;
}
