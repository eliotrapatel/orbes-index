/**
 * Thirteen months of « where they come from » at the unit of the plan (plan CUSTOMER INTELLIGENCE of 2026-10-08, §8:
 * 1,000 visitors a day), written in bulk into a migrated, empty database, as test data is (generate_series): for
 * scripts/acquisition-size.ts (the sizes of migration 0043's tables, step 4.12) and scripts/bench.ts --arrivals (the
 * Links report's time, step 4.13). Dev only: it never runs in production.
 *
 * From the Paris day 13 calendar months before `end` (tracking.ts viewHistoryCutoff) through `end`'s own Paris day,
 * each day: 600 new devices (half of them arriving Direct, the others through a link, campaign tags or a site), 1,000
 * visits with a source (the 600 new devices' and 400 returns of earlier devices, one per device, source and day), 100
 * sign-ups (each on one of the day's new devices, with its first source and its SIGNUP conversion), 60 draw entries and
 * 40 orders of the private salon (its request, its invoice; one in twenty cancelled with its credit note), each with its
 * conversion; 5 new campaigns; about 50 sources visited (the 30 links, 15 of the sites, the day's campaigns). The house: the seven channels, 30 links, 300 referring sites. Every day before `end`'s is
 * summarised into `acquisition_daily` by the job itself (summariseDays), as the morning window leaves it; `end`'s own
 * visits stay raw, as today's do. The conversions' last links are drawn, not judged (the job's rule is its tests'):
 * what is measured here is bytes and reading times.
 */
import { sql, type RawBuilder } from 'kysely';
import type { Db } from '../src/server/db/connection.js';
import { AcquisitionService } from '../src/server/services/acquisition.js';
import { summariseDays } from '../src/server/services/acquisition-jobs.js';
import { parisDay, parisDayStart } from '../src/server/services/schedule.js';
import { nextParisDay, viewHistoryCutoff } from '../src/server/services/tracking.js';
import { GrowthWorld } from '../test/support/growth.js';

/** The unit of §8, per Paris day. */
export const ACQUISITION_UNIT = Object.freeze({
  newDevices: 600,
  visits: 1_000,
  signups: 100,
  entries: 60,
  orders: 40,
  campaigns: 5,
  links: 30,
  sites: 300,
});

export interface AcquisitionFill {
  days: number;
  firstDay: string;
  lastDay: string;
  rows: Record<string, number>;
}

const count = async (db: Db, table: string): Promise<number> => Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(table)}`.execute(db)).rows[0]!.n);

/** Fill a migrated, empty database (see the header); `end` must fall in the morning window (from 07:30 UTC). */
export async function fillAcquisition(db: Db, end: Date, log: (m: string) => void = () => {}): Promise<AcquisitionFill> {
  const U = ACQUISITION_UNIT;
  const firstDay = parisDay(viewHistoryCutoff(end));
  const lastDay = parisDay(end);
  const days: { d: number; day: string; start: Date }[] = [];
  for (let day = firstDay, d = 0; day <= lastDay; day = nextParisDay(day), d++) days.push({ d, day, start: parisDayStart(day) });
  const start = days[0]!.start;
  await new AcquisitionService({ db, publicOrigin: 'https://verify.orbes.bench', clock: () => start }).prepare();
  const w = await new GrowthWorld(db).prepare();
  const model = await w.model('MONOLITHE', { price: [25_000, 'EUR'] });
  await sql`CREATE TEMP TABLE fill_days (d int PRIMARY KEY, day date NOT NULL, start timestamptz NOT NULL)`.execute(db);
  await sql`INSERT INTO fill_days (d, day, start)
            SELECT * FROM unnest(${sql.raw(`ARRAY[${days.map((x) => x.d).join(',')}]::int[]`)}, ${sql.raw(`ARRAY[${days.map((x) => `'${x.day}'`).join(',')}]::date[]`)},
                                 ${sql.raw(`ARRAY[${days.map((x) => `'${x.start.toISOString()}'`).join(',')}]::timestamptz[]`)})`.execute(db);
  const D = days.length;
  log(`fill: ${D} Paris days, ${firstDay} to ${lastDay}`);

  // The house: an admin, 30 links over the seven channels, 300 sites, 5 campaigns a day.
  const admin = (await db.insertInto('admin_users').values({ email: 'acq-fill@orbes.bench', email_normalized: 'acq-fill@orbes.bench', password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow()).id;
  await sql`
    INSERT INTO links (code, name, channel_id, destination, cost_minor, cost_currency, created_by, created_at, updated_at)
    SELECT 'fill-link-' || g, 'Link ' || g, c.id, 'NOW', CASE WHEN g % 3 = 0 THEN 10000 * g END, CASE WHEN g % 3 = 0 THEN 'EUR' END, ${admin}::uuid, ${start}::timestamptz, ${start}::timestamptz
      FROM generate_series(1, ${U.links}::int) g
      JOIN (SELECT id, row_number() OVER (ORDER BY position) - 1 AS n FROM link_channels) c ON c.n = g % 7`.execute(db);
  await sql`INSERT INTO acquisition_sources (kind, link_id, key, created_at) SELECT 'LINK', id, 'L:' || id, created_at FROM links`.execute(db);
  await sql`INSERT INTO acquisition_sources (kind, site, key, created_at)
            SELECT 'SITE', 'site-' || g || '.example', 'S:site-' || g || '.example', ${start}::timestamptz FROM generate_series(1, ${U.sites}::int) g`.execute(db);
  await sql`INSERT INTO acquisition_sources (kind, utm_source, utm_medium, utm_campaign, utm_content, key, created_at)
            SELECT 'CAMPAIGN', (ARRAY['instagram','tiktok','newsletter','google'])[1 + k % 4], (ARRAY['story','bio','paid'])[1 + k % 3],
                   'drop-' || fd.d || '-' || k, CASE WHEN k % 2 = 0 THEN 'variant-' || k END,
                   'C:' || (ARRAY['instagram','tiktok','newsletter','google'])[1 + k % 4] || chr(31) || (ARRAY['story','bio','paid'])[1 + k % 3] || chr(31) || 'drop-' || fd.d || '-' || k
                        || chr(31) || coalesce(CASE WHEN k % 2 = 0 THEN 'variant-' || k END, '') || chr(31),
                   fd.start + make_interval(secs => k * 3600)
              FROM fill_days fd, generate_series(0, ${U.campaigns - 1}::int) k`.execute(db);
  const direct = (await db.selectFrom('acquisition_sources').select('id').where('key', '=', 'DIRECT').executeTakeFirstOrThrow()).id;
  const pool = (await db.selectFrom('acquisition_sources').select('id').where('kind', 'in', ['LINK', 'SITE', 'CAMPAIGN']).orderBy('id').execute()).map((r) => r.id);
  const P = pool.length;
  const poolArray = sql.raw(`ARRAY[${pool.join(',')}]::int[]`);
  const ofKind = async (kind: 'LINK' | 'SITE' | 'CAMPAIGN') => sql.raw(`ARRAY[${(await db.selectFrom('acquisition_sources').select('id').where('kind', '=', kind).orderBy('created_at').orderBy('id').execute()).map((r) => r.id).join(',')}]::int[]`);
  const linkArray = await ofKind('LINK');
  const siteArray = await ofKind('SITE');
  const campaignArray = await ofKind('CAMPAIGN');
  /**
   * A source of day `d` for the slot `n`: about 50 sources a day, as a house sees them: the 30 links (six visits in
   * ten), 15 of the sites (turning from day to day) and the day's 5 campaigns.
   */
  const daySource = (d: RawBuilder<unknown>, n: RawBuilder<unknown>) => {
    const r = sql`((${n})::bigint * 104729 % 50)::int`;
    return sql`(CASE WHEN ${r} < ${U.links} THEN (${linkArray})[1 + ${r}]
                     WHEN ${r} < ${U.links + 15} THEN (${siteArray})[1 + ((${d}) * 7 + ${r}) % ${U.sites}]
                     ELSE (${campaignArray})[1 + (${d}) * ${U.campaigns} + (${r} - ${U.links + 15}) % ${U.campaigns}] END)`;
  };

  // The devices: 600 a day, their pseudonyms 43 base64url characters of a SHA-256, half Direct.
  await sql`
    INSERT INTO tracking_devices (device_hash, kind, os, browser, opened_in, in_app, first_seen_at, last_seen_at, first_source_id)
    SELECT translate(substr(encode(sha256(convert_to('acq-fill-device-' || fd.d || '-' || k, 'UTF8')), 'base64'), 1, 43), '+/', '-_'),
           (ARRAY['PHONE','PHONE','PHONE','COMPUTER','TABLET'])[1 + k % 5], (ARRAY['IOS','IOS','ANDROID','MACOS','WINDOWS'])[1 + k % 5],
           (ARRAY['SAFARI','SAFARI','CHROME','CHROME','FIREFOX'])[1 + k % 5],
           CASE WHEN k % 7 = 0 THEN 'IN_APP' ELSE 'BROWSER' END, CASE WHEN k % 7 = 0 THEN 'INSTAGRAM' END,
           fd.start + make_interval(secs => k * 143.0), fd.start + make_interval(secs => k * 143.0 + 1800),
           CASE WHEN (fd.d + k) % 2 = 0 THEN ${direct}::integer ELSE ${daySource(sql`fd.d`, sql`fd.d * 600 + k`)} END
      FROM fill_days fd, generate_series(0, ${U.newDevices - 1}::int) k
     ORDER BY fd.d, k`.execute(db);
  const firstDevice = Number((await sql<{ m: number }>`SELECT min(id) AS m FROM tracking_devices`.execute(db)).rows[0]!.m);
  if ((await count(db, 'tracking_devices')) !== D * U.newDevices) throw new Error('devices: not one per slot');
  log(`devices: ${D * U.newDevices}`);

  // The visits: the day's 600 new devices (their own first source, or a source of the pool for the Direct ones) and 400
  // returns of earlier devices through a source of the pool; one per device, source and day.
  await sql`
    INSERT INTO acquisition_touches (device_id, source_id, day, first_at, last_at, arrivals)
    SELECT v.device_id, CASE WHEN v.i < ${U.newDevices} AND d.first_source_id <> ${direct}::integer THEN d.first_source_id ELSE v.pooled END,
           v.day, v.first_at, v.first_at + make_interval(secs => (v.i % 5) * 600), 1 + (v.i % 3 = 0)::int
      FROM (SELECT fd.day, i, fd.start + make_interval(secs => i * 86.0) AS first_at,
                   CASE WHEN i < ${U.newDevices} THEN ${firstDevice} + fd.d * ${U.newDevices} + i
                        ELSE ${firstDevice} + ((fd.d * 1000 + i)::bigint * 2654435761 % greatest(fd.d * ${U.newDevices}, ${U.newDevices}))::int END AS device_id,
                   ${daySource(sql`fd.d`, sql`fd.d * 1000 + i + 7`)} AS pooled
              FROM fill_days fd CROSS JOIN generate_series(0, ${U.visits - 1}::int) i) v
      JOIN tracking_devices d ON d.id = v.device_id
    ON CONFLICT (device_id, source_id, day) DO NOTHING`.execute(db);
  log(`visits: ${await count(db, 'acquisition_touches')}`);

  // The sign-ups: 100 a day, each on one of the day's new devices, linked to it with its first source.
  await sql`
    INSERT INTO accounts (email, email_normalized, password_hash, country, created_at)
    SELECT 'acq-' || fd.d || '-' || k || '@bench.test', 'acq-' || fd.d || '-' || k || '@bench.test', 'unused',
           (ARRAY['FR','GB','US','IT','DE'])[1 + k % 5], fd.start + make_interval(secs => k * 143.0 + 900)
      FROM fill_days fd, generate_series(0, ${U.signups - 1}::int) k ORDER BY fd.d, k`.execute(db);
  await sql`CREATE TEMP TABLE fill_accounts AS SELECT id, created_at, row_number() OVER (ORDER BY created_at, id)::int - 1 AS n FROM accounts WHERE email LIKE 'acq-%@bench.test'`.execute(db);
  await sql`CREATE INDEX ON fill_accounts (n)`.execute(db);
  // The account n was made on day n / 100, on the device (day, n % 100).
  await sql`
    UPDATE tracking_devices d SET account_id = a.id, linked_at = a.created_at
      FROM fill_accounts a WHERE d.id = ${firstDevice} + (a.n / ${U.signups}) * ${U.newDevices} + a.n % ${U.signups}`.execute(db);
  await sql`UPDATE acquisition_touches t SET account_id = d.account_id FROM tracking_devices d WHERE d.id = t.device_id AND d.account_id IS NOT NULL`.execute(db);
  await sql`
    INSERT INTO account_sources (account_id, first_source_id, first_seen_at, set_at, set_by)
    SELECT d.account_id, d.first_source_id, d.first_seen_at, d.linked_at, 'SIGN_UP' FROM tracking_devices d WHERE d.account_id IS NOT NULL`.execute(db);
  await sql`
    INSERT INTO acquisition_conversions (kind, ref_id, account_id, at, last_source_id, created_at)
    SELECT 'SIGNUP', a.id, a.id, a.created_at, CASE WHEN a.n % 10 < 7 THEN s.first_source_id ELSE (${poolArray})[1 + (a.n * 31) % ${P}] END, a.created_at
      FROM fill_accounts a JOIN account_sources s ON s.account_id = a.id`.execute(db);
  log(`sign-ups: ${await count(db, 'account_sources')}`);

  // The draws, one a month, and 60 entries a day of accounts already made; their conversions.
  const months = [...new Set(days.map((x) => x.day.slice(0, 7)))];
  const drops: string[] = [];
  for (const m of months) drops.push((await w.drop({ mode: 'DRAW', modelId: model, title: `DRAW ${m}`, opens: `${m}-01`, quantity: 50 })).id);
  const dropArray = sql.raw(`ARRAY[${drops.map((x) => `'${x}'`).join(',')}]::uuid[]`);
  const monthIndex = sql.raw(`(ARRAY[${months.map((m) => `'${m}'`).join(',')}]::text[])`);
  await sql`
    INSERT INTO drop_entries (drop_id, account_id, created_at, status)
    SELECT (${dropArray})[array_position(${monthIndex}, to_char(fd.day, 'YYYY-MM'))], a.id, fd.start + make_interval(secs => j * 1400.0 + 3600), 'ENTERED'
      FROM fill_days fd CROSS JOIN generate_series(0, ${U.entries - 1}::int) j
      JOIN fill_accounts a ON a.n = ((fd.d * ${U.entries} + j)::bigint * 7919 % ((fd.d + 1) * ${U.signups}))::int
    ON CONFLICT (drop_id, account_id) DO NOTHING`.execute(db);
  await sql`
    INSERT INTO acquisition_conversions (kind, ref_id, account_id, at, last_source_id, created_at)
    SELECT 'DRAW_ENTRY', e.id, e.account_id, e.created_at, CASE WHEN abs(hashtext(e.id::text)) % 2 = 0 THEN s.first_source_id ELSE (${poolArray})[1 + abs(hashtext(e.id::text)) % ${P}] END, e.created_at
      FROM drop_entries e JOIN account_sources s ON s.account_id = e.account_id`.execute(db);
  log(`entries: ${await count(db, 'drop_entries')}`);

  // The orders: 40 a day of the private salon, each with its request and invoice; one in twenty cancelled with its credit note.
  await sql`
    INSERT INTO shop_requests (account_id, model_id, note, status, created_at, handled_at, outcome)
    SELECT a.id, ${model}::uuid, 'ACQ-' || fd.d || '-' || j, 'CLOSED', fd.start + make_interval(secs => j * 2000.0), fd.start + make_interval(secs => j * 2000.0 + 3600), 'ACCEPTED'
      FROM fill_days fd CROSS JOIN generate_series(0, ${U.orders - 1}::int) j
      JOIN fill_accounts a ON a.n = ((fd.d * ${U.orders} + j)::bigint * 104729 % ((fd.d + 1) * ${U.signups}))::int`.execute(db);
  await sql`
    INSERT INTO orders (channel, account_id, model_id, shop_request_id, price_minor, currency, status, reserved_at, paid_at, cancelled_at, location_id)
    SELECT 'SALON', r.account_id, r.model_id, r.id, 20000 + (abs(hashtext(r.note)) % 4) * 5000, 'EUR',
           CASE WHEN abs(hashtext(r.note)) % 20 = 1 THEN 'CANCELLED' ELSE 'PAID' END, r.handled_at, r.handled_at + interval '30 minutes',
           CASE WHEN abs(hashtext(r.note)) % 20 = 1 THEN r.handled_at + interval '1 day' END, ${w.location}::uuid
      FROM shop_requests r WHERE r.note LIKE 'ACQ-%'`.execute(db);
  const lines = JSON.stringify([{ kind: 'PIECE', label: 'PIECE', detail: 'THE PRIVATE SALON', amountMinor: 0 }]);
  await sql`
    INSERT INTO invoices (kind, year, sequence, order_id, issuer, buyer, lines, currency, subtotal_minor, total_minor, issued_at)
    SELECT 'INVOICE', extract(year FROM paid_at AT TIME ZONE 'UTC')::int, 800000 + row_number() OVER (ORDER BY id), id, '{"name":"CONGLOMERAT LLC"}', '{}', ${lines}::jsonb,
           currency, price_minor, price_minor, paid_at
      FROM orders WHERE channel = 'SALON' AND paid_at IS NOT NULL`.execute(db);
  await sql`
    INSERT INTO invoices (kind, year, sequence, order_id, credits_invoice_id, credit_scope, issuer, buyer, lines, currency, subtotal_minor, total_minor, issued_at)
    SELECT 'CREDIT_NOTE', extract(year FROM o.cancelled_at AT TIME ZONE 'UTC')::int, 800000 + row_number() OVER (ORDER BY o.id), o.id, i.id, 'FULL', i.issuer, i.buyer, i.lines,
           i.currency, i.subtotal_minor, i.total_minor, o.cancelled_at
      FROM orders o JOIN invoices i ON i.order_id = o.id AND i.kind = 'INVOICE' WHERE o.status = 'CANCELLED'`.execute(db);
  await sql`
    INSERT INTO acquisition_conversions (kind, ref_id, account_id, at, last_source_id, created_at)
    SELECT 'ORDER', o.id, o.account_id, r.created_at, CASE WHEN abs(hashtext(o.id::text)) % 2 = 0 THEN s.first_source_id ELSE (${poolArray})[1 + abs(hashtext(o.id::text)) % ${P}] END, o.reserved_at
      FROM orders o JOIN shop_requests r ON r.id = o.shop_request_id JOIN account_sources s ON s.account_id = o.account_id`.execute(db);
  log(`orders: ${await count(db, 'orders')}`);

  // The days before `end`'s, summarised by the job itself; the watermark and the catch-up as the job leaves them.
  let summarised = 0;
  for (let n = await summariseDays(db, end); n > 0; n = await summariseDays(db, end)) summarised += n;
  await db.updateTable('acquisition_state').set({ conversions_until: end, catch_up_on: lastDay }).where('id', '=', 1).execute();
  await sql`DROP TABLE fill_accounts`.execute(db);
  await sql`DROP TABLE fill_days`.execute(db);
  log(`summarised: ${summarised} days`);
  const rows: Record<string, number> = {};
  for (const t of ['link_channels', 'links', 'acquisition_sources', 'acquisition_touches', 'account_sources', 'acquisition_conversions', 'acquisition_daily', 'acquisition_state', 'tracking_devices', 'accounts', 'drop_entries', 'orders', 'invoices']) {
    rows[t] = await count(db, t);
  }
  return { days: D, firstDay, lastDay, rows };
}
