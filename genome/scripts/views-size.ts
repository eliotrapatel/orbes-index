/**
 * The views' sizes, measured (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.3 T.6 and T.7, §8, step 3.7). Dev only: it
 * never runs in production and writes nothing but its own throwaway database.
 *
 *   npx tsx scripts/views-size.ts --dir /abs/scratch/dir [--rows 1000000] [--json PATH]
 *   ORBES_TEST_POSTGRES_URL=postgres://… npx tsx scripts/views-size.ts [--rows N] [--json PATH]
 *
 * Without ORBES_TEST_POSTGRES_URL it runs on PGlite with its data directory on disk (`--dir`, an absolute directory
 * that must not exist yet; the WASM build of PostgreSQL, so the pages and tuples are PostgreSQL's own); with it, on a
 * throwaway database created on that server and dropped at the end.
 *
 *   1. Fill: the migrations, 10 000 accounts, 300 places, 240 000 devices (600 a day for 13 months, the unit of T.7;
 *      their pseudonyms 43 base64url characters of a SHA-256, as incompressible as the real ones), then `--rows`
 *      synthetic views and scans (1 000 000 by default) spread evenly over 13 Paris calendar months with a random
 *      instant in each row's slot, in time order, as the buffer writes them: visits of 8 rows of one device, 30 % of the devices signed in, 1 row in
 *      80 a SCAN, a model or a release as the subject of a MODEL or RELEASE row, the device's usual place.
 *   2. The daily job (services/tracking-jobs.ts aggregateViews) counts every day and writes every month.
 *   3. Sizes: pg_relation_size, pg_indexes_size and pg_total_relation_size of every table of migration 0042, per row;
 *      the nightly backup ESTIMATED per table as its COPY text compressed with zlib level 6 (what `pg_dump -Fc -Z6`
 *      writes for a table's data; indexes are not in a dump). On PGlite the text is COPY's own (`COPY … TO
 *      '/dev/blob'`); on PostgreSQL, whose driver here has no COPY stream, the same columns joined by tabs as COPY's
 *      text format writes them. The real `pg_dump -Fc -Z6` is the owner's to run (the hand-over).
 *   4. The 13-month purge-and-refill cycle: a month later, purgeViews folds and deletes the oldest month, VACUUM
 *      (autovacuum's work) frees its pages, a month of new rows is written into them, the new days are counted; the
 *      sizes again; then EXPLAIN (ANALYZE, BUFFERS) of the day query (the daily count's SELECT) on a refilled day:
 *      it must read that day's pages on `collector_views_at_idx`, never the whole table.
 *
 * Prints the figures and writes them as JSON (`--json`, default out/views-size.json).
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createDeflate } from 'node:zlib';
import { sql } from 'kysely';
import type { PGlite } from '@electric-sql/pglite';
import { closeDb, createDb, createDbFromPGlite, PGLITE_PARSERS, type Db } from '../src/server/db/connection.js';
import { migrateToLatest } from '../src/server/db/migrate.js';
import { VIEW_PAGE_CODES } from '../src/server/db/schema.js';
import { parisDay, parisDayStart } from '../src/server/services/schedule.js';
import { aggregateViews, purgeViews } from '../src/server/services/tracking-jobs.js';
import { nextParisDay, viewHistoryCutoff } from '../src/server/services/tracking.js';

const ACCOUNTS = 10_000;
const PLACES = 300;
const DEVICES = 240_000;
const MODELS = 60;
const RELEASES = 20;
const CHUNK = 100_000;
/** The fill ends here: 13 Paris months of rows before it, the purge one month later. */
const FILL_END = new Date('2027-10-08T08:00:00Z');
const CYCLE_END = new Date('2027-11-08T08:00:00Z');

const TABLES = [
  'collector_views',
  'tracking_devices',
  'tracking_device_accounts',
  'geo_places',
  'view_daily_stats',
  'device_daily_stats',
  'collector_places',
  'collector_view_totals',
  'collector_view_months',
  'tracking_state',
] as const;

/** 80 slots: the pages of a visit in their proportions (1 in 80 a SCAN, as 100 scans for 7 900 views). */
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
if (PAGE_MIX.length !== 80) throw new Error('PAGE_MIX must hold 80 slots');

interface TableSize {
  rows: number;
  table: number;
  indexes: number;
  total: number;
  dump: number;
}

function uuids(n: number): string[] {
  return Array.from({ length: n }, () => {
    const b = randomBytes(16);
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const h = b.toString('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  });
}

const literalArray = (values: readonly (string | number)[], type: string) => sql.raw(`ARRAY[${values.map((v) => (typeof v === 'number' ? String(v) : `'${v}'`)).join(',')}]::${type}[]`);

/** Write `rows` rows evenly from `from` to `to`, in time order, numbered from `offset` (the visits and devices follow it). */
async function fillViews(db: Db, from: Date, to: Date, rows: number, offset: number, models: string[], releases: string[]): Promise<void> {
  const span = (to.getTime() - from.getTime()) / 1000;
  const pages = literalArray(PAGE_MIX, 'smallint');
  const modelIds = literalArray(models, 'uuid');
  const releaseIds = literalArray(releases, 'uuid');
  for (let start = 0; start < rows; start += CHUNK) {
    const end = Math.min(rows, start + CHUNK) - 1;
    await sql`
      INSERT INTO collector_views (at, device_id, account_id, page, subject, seconds, place_id)
      SELECT ${from}::timestamptz + make_interval(secs => ((s.i::double precision + random() * 0.9) * ${span} / ${rows})),
             s.dev,
             CASE WHEN s.dev % 10 < 3 THEN acc.ids[1 + s.dev % ${ACCOUNTS}] END,
             s.pg,
             CASE WHEN s.pg IN (${VIEW_PAGE_CODES.MODEL}, ${VIEW_PAGE_CODES.SCAN}, ${VIEW_PAGE_CODES.PIECE}) THEN (${modelIds})[1 + (s.i * 7 + s.dev) % ${MODELS}]
                  WHEN s.pg = ${VIEW_PAGE_CODES.RELEASE} THEN (${releaseIds})[1 + (s.i + s.dev) % ${RELEASES}] END,
             CASE WHEN s.pg = ${VIEW_PAGE_CODES.SCAN} THEN 0 ELSE 1 + floor(power(random(), 2) * 300)::int END,
             dev0.first + 1 + s.dev % ${PLACES}
        FROM (SELECT g AS i,
                     (SELECT min(id) FROM tracking_devices) + (((g + ${offset}) / 8)::bigint * 2654435761 % ${DEVICES})::int AS dev,
                     (${pages})[1 + ((g + ${offset}) * 37) % 80] AS pg
                FROM generate_series(${start}::int, ${end}::int) g) s,
             (SELECT array_agg(id ORDER BY email) AS ids FROM accounts) acc,
             (SELECT min(id) - 1 AS first FROM geo_places) dev0`.execute(db);
  }
}

/** The COPY text of a table, compressed with zlib level 6 as `pg_dump -Fc -Z6` compresses a table's data, in bytes. */
async function dumpBytes(db: Db, pglite: PGlite | null, table: string): Promise<number> {
  const deflate = createDeflate({ level: 6 });
  let out = 0;
  deflate.on('data', (c: Buffer) => (out += c.length));
  const done = new Promise<void>((ok, ko) => {
    deflate.on('end', ok);
    deflate.on('error', ko);
  });
  const write = (b: Uint8Array) => new Promise<void>((ok) => (deflate.write(b) ? ok() : deflate.once('drain', ok)));
  if (pglite) {
    // COPY's own text, by ctid pages so the WASM memory never holds the whole table.
    const pages = Number((await sql<{ n: number }>`SELECT pg_relation_size(${table}::regclass) / current_setting('block_size')::int AS n`.execute(db)).rows[0]?.n ?? 0);
    const step = 4_000;
    for (let p = 0; p <= pages; p += step) {
      const r = await pglite.query(`COPY (SELECT * FROM ${table} WHERE ctid >= '(${p},0)'::tid AND ctid < '(${p + step},0)'::tid) TO '/dev/blob'`);
      if (r.blob) await write(new Uint8Array(await r.blob.arrayBuffer()));
    }
  } else {
    // PostgreSQL through node-postgres: the same text, COPY's format rebuilt column by column.
    const cols = (await sql<{ name: string }>`SELECT attname AS name FROM pg_attribute WHERE attrelid = ${table}::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum`.execute(db)).rows.map((r) => r.name);
    const line = sql.raw(`concat_ws(E'\\t', ${cols.map((c) => `coalesce(${c}::text, '\\N')`).join(', ')}) || E'\\n'`);
    let after = '(0,0)';
    for (;;) {
      const r = await sql<{ t: string; c: string }>`SELECT ${line} AS t, ctid::text AS c FROM ${sql.table(table)} WHERE ctid > ${after}::tid ORDER BY ctid LIMIT 50000`.execute(db);
      if (r.rows.length === 0) break;
      await write(Buffer.from(r.rows.map((x) => x.t).join(''), 'utf8'));
      after = r.rows[r.rows.length - 1]!.c;
    }
  }
  deflate.end();
  await done;
  return out;
}

async function sizes(db: Db, pglite: PGlite | null): Promise<Record<string, TableSize>> {
  const out: Record<string, TableSize> = {};
  for (const t of TABLES) {
    const r = (
      await sql<{ rows: number; t: number; i: number; total: number }>`
        SELECT (SELECT count(*) FROM ${sql.table(t)})::bigint AS rows, pg_relation_size(${t}::regclass) AS t,
               pg_indexes_size(${t}::regclass) AS i, pg_total_relation_size(${t}::regclass) AS total`.execute(db)
    ).rows[0]!;
    out[t] = { rows: Number(r.rows), table: Number(r.t), indexes: Number(r.i), total: Number(r.total), dump: await dumpBytes(db, pglite, t) };
  }
  return out;
}

const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`;
const per = (n: number, rows: number) => (rows > 0 ? (n / rows).toFixed(1) : '—');

function print(label: string, s: Record<string, TableSize>): void {
  process.stdout.write(`\n${label}\n| Table | Rows | Table | Indexes | Total | Dump (estimate) | B/row table | B/row indexes | B/row total | B/row dump |\n|---|---|---|---|---|---|---|---|---|---|\n`);
  for (const [t, v] of Object.entries(s)) {
    process.stdout.write(`| ${t} | ${v.rows} | ${mb(v.table)} | ${mb(v.indexes)} | ${mb(v.total)} | ${mb(v.dump)} | ${per(v.table, v.rows)} | ${per(v.indexes, v.rows)} | ${per(v.total, v.rows)} | ${per(v.dump, v.rows)} |\n`);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { dir: { type: 'string' }, rows: { type: 'string' }, json: { type: 'string' } } });
  const rows = Number(values.rows ?? 1_000_000);
  if (!Number.isInteger(rows) || rows < 10_000) throw new Error('--rows: at least 10 000');
  const pgUrl = process.env.ORBES_TEST_POSTGRES_URL;
  let db: Db;
  let pglite: PGlite | null = null;
  let cleanup: () => Promise<void>;
  let engine: string;
  if (pgUrl) {
    const admin = createDb(pgUrl);
    const name = `orbes_views_size_${randomBytes(4).toString('hex')}`;
    await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin);
    const u = new URL(pgUrl);
    u.pathname = `/${name}`;
    db = createDb(u.toString(), { statementTimeoutMs: 0 });
    engine = (await sql<{ v: string }>`SELECT version() AS v`.execute(db)).rows[0]!.v;
    cleanup = async () => {
      await closeDb(db);
      await sql`DROP DATABASE IF EXISTS ${sql.id(name)} WITH (FORCE)`.execute(admin);
      await closeDb(admin);
    };
  } else {
    if (!values.dir || !isAbsolute(values.dir)) throw new Error('--dir: an absolute directory for PGlite (or set ORBES_TEST_POSTGRES_URL)');
    if (existsSync(values.dir)) throw new Error(`--dir: ${values.dir} exists already; give a new directory`);
    const { PGlite } = await import('@electric-sql/pglite');
    pglite = new PGlite({ dataDir: values.dir, parsers: PGLITE_PARSERS });
    db = createDbFromPGlite(pglite);
    engine = (await sql<{ v: string }>`SELECT version() AS v`.execute(db)).rows[0]!.v;
    cleanup = () => closeDb(db);
  }
  const t0 = Date.now();
  const log = (m: string) => process.stdout.write(`[${((Date.now() - t0) / 1000).toFixed(0)} s] ${m}\n`);
  try {
    log(`engine: ${engine}`);
    await migrateToLatest(db);
    await sql`SELECT setseed(0.42)`.execute(db);
    const from = viewHistoryCutoff(FILL_END);
    await db.insertInto('tracking_state').values({ id: 1, started_at: from, scans_backfilled_at: from }).execute();
    await sql`INSERT INTO accounts (email, email_normalized, password_hash)
              SELECT 'views-size-' || g || '@example.test', 'views-size-' || g || '@example.test', 'unused' FROM generate_series(1, ${ACCOUNTS}::int) g`.execute(db);
    const countries = ['FR', 'GB', 'DE', 'IT', 'ES', 'US', 'CH', 'BE', 'NL', 'JP'];
    await sql`INSERT INTO geo_places (country, city)
              SELECT (${literalArray(countries, 'text')})[1 + g % 10], CASE WHEN g <= 10 THEN NULL ELSE 'City ' || g END FROM generate_series(1, ${PLACES}::int) g`.execute(db);
    await sql`INSERT INTO tracking_devices (device_hash, kind, os, browser, opened_in, in_app, first_seen_at, last_seen_at)
              SELECT translate(substr(encode(sha256(convert_to('views-size-device-' || g, 'UTF8')), 'base64'), 1, 43), '+/', '-_'),
                     (ARRAY['PHONE','PHONE','PHONE','COMPUTER','TABLET'])[1 + g % 5],
                     (ARRAY['IOS','IOS','ANDROID','MACOS','WINDOWS'])[1 + g % 5],
                     (ARRAY['SAFARI','SAFARI','CHROME','CHROME','FIREFOX'])[1 + g % 5],
                     CASE WHEN g % 7 = 0 THEN 'IN_APP' ELSE 'BROWSER' END,
                     CASE WHEN g % 7 = 0 THEN 'INSTAGRAM' END,
                     ${from}::timestamptz + make_interval(secs => g * 140.0),
                     ${from}::timestamptz + make_interval(secs => g * 140.0 + 3600)
                FROM generate_series(1, ${DEVICES}::int) g`.execute(db);
    // The devices signed in are linked to their account, as the link leaves them.
    await sql`INSERT INTO tracking_device_accounts (device_id, account_id, first_via, first_linked_at, last_linked_at)
              SELECT d.id, acc.ids[1 + d.id % ${ACCOUNTS}], 'SIGN_IN', d.first_seen_at, d.first_seen_at
                FROM tracking_devices d, (SELECT array_agg(id ORDER BY email) AS ids FROM accounts) acc WHERE d.id % 10 < 3`.execute(db);
    const models = uuids(MODELS);
    const releases = uuids(RELEASES);
    log(`fill: ${rows} rows from ${from.toISOString()} to ${FILL_END.toISOString()}`);
    await fillViews(db, from, parisDayStart(parisDay(FILL_END)), rows, 0, models, releases);
    log('fill done; counting the days');
    const counted = await aggregateViews(db, FILL_END, { maxDays: 1_000 });
    log(`counted ${counted.days} days, ${counted.months} months`);
    await sql`VACUUM ANALYZE`.execute(db);
    const filled = await sizes(db, pglite);
    print(`After the fill (${rows} rows, 13 months)`, filled);

    // The cycle: a month later, the oldest month folded and deleted, its pages freed, a month of new rows into them.
    const cutoff = viewHistoryCutoff(CYCLE_END);
    const oldDays = Math.round((cutoff.getTime() - from.getTime()) / 86_400_000);
    const monthRows = Math.round((rows * (CYCLE_END.getTime() - FILL_END.getTime())) / (FILL_END.getTime() - from.getTime()));
    let deleted = 0;
    for (;;) {
      const n = await purgeViews(db, CYCLE_END, { maxDays: 7 });
      deleted += n;
      if (n === 0) break;
    }
    log(`purged ${deleted} rows (${oldDays} Paris days before ${cutoff.toISOString()})`);
    await sql`VACUUM ANALYZE collector_views`.execute(db);
    const refillFrom = parisDayStart(parisDay(FILL_END));
    await fillViews(db, refillFrom, parisDayStart(parisDay(CYCLE_END)), monthRows, rows, models, releases);
    const recounted = await aggregateViews(db, CYCLE_END, { maxDays: 1_000 });
    log(`refilled ${monthRows} rows from ${refillFrom.toISOString()}; counted ${recounted.days} days, ${recounted.months} months`);
    await sql`VACUUM ANALYZE collector_views`.execute(db);
    const cycled = await sizes(db, pglite);
    print('After the purge-and-refill cycle', cycled);

    // The day query on a refilled day: the daily count's SELECT.
    const day = parisDay(new Date(refillFrom.getTime() + 12 * 86_400_000));
    const start = parisDayStart(day);
    const end = parisDayStart(nextParisDay(day));
    const plan = (
      await sql<{ 'QUERY PLAN': string }>`
        EXPLAIN (ANALYZE, BUFFERS)
        SELECT v.page, coalesce(v.subject, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(gp.country, 'ZZ'),
               count(*)::int, coalesce(sum(v.seconds), 0)::int, count(DISTINCT v.device_id)::int, count(v.account_id)::int
          FROM collector_views v LEFT JOIN geo_places gp ON gp.id = v.place_id
         WHERE v.at >= ${start} AND v.at < ${end}
         GROUP BY 1, 2, 3`.execute(db)
    ).rows.map((r) => r['QUERY PLAN']);
    const dayRows = Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM collector_views WHERE at >= ${start} AND at < ${end}`.execute(db)).rows[0]!.n);
    const dayPages = Number(
      (await sql<{ n: number }>`SELECT count(DISTINCT (ctid::text::point)[0])::int AS n FROM collector_views WHERE at >= ${start} AND at < ${end}`.execute(db)).rows[0]!.n,
    );
    const tablePages = Number((await sql<{ n: number }>`SELECT (pg_relation_size('collector_views') / current_setting('block_size')::int)::int AS n`.execute(db)).rows[0]!.n);
    const text = plan.join('\n');
    const onIndex = /collector_views_at_idx/.test(text) && !/Seq Scan on collector_views/.test(text);
    process.stdout.write(`\nEXPLAIN (ANALYZE, BUFFERS) of the day query, ${day} (refilled): ${dayRows} rows on ${dayPages} heap pages of ${tablePages}\n${text}\n`);
    process.stdout.write(`\nThe day query ${onIndex ? 'reads collector_views_at_idx (no full scan)' : 'DOES NOT read collector_views_at_idx only'}.\n`);
    const result = { engine, rows, from: from.toISOString(), fillEnd: FILL_END.toISOString(), cycleEnd: CYCLE_END.toISOString(), deleted, monthRows, filled, cycled, explain: { day, dayRows, dayPages, tablePages, onIndex, plan } };
    const json = resolve(values.json ?? 'out/views-size.json');
    mkdirSync(dirname(json), { recursive: true });
    writeFileSync(json, `${JSON.stringify(result, null, 2)}\n`);
    log(`written ${json}`);
    if (!onIndex) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
