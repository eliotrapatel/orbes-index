/**
 * The sizes of « where they come from », measured (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.6 and A.16, §8, step
 * 4.12), as scripts/views-size.ts measured the views at step 3.7. Dev only: it never runs in production and writes
 * nothing but its own throwaway database.
 *
 *   npx tsx scripts/acquisition-size.ts --dir /abs/scratch/dir [--json PATH]
 *   ORBES_TEST_POSTGRES_URL=postgres://… npx tsx scripts/acquisition-size.ts [--json PATH]
 *
 * Without ORBES_TEST_POSTGRES_URL it runs on PGlite with its data directory on disk (`--dir`, an absolute directory that
 * must not exist yet: the WASM build of PostgreSQL, so pages and tuples are PostgreSQL's own); with it, on a throwaway
 * database created on that server and dropped at the end.
 *
 *   1. Fill: the migrations, then 13 months at the unit of §8 (scripts/acquisition-fill.ts: 1,000 visits, 600 new
 *      devices, 100 sign-ups, 60 entries and 40 orders a day, each act with its conversion; the daily summary written by
 *      the job).
 *   2. Sizes: pg_relation_size, pg_indexes_size and pg_total_relation_size of the eight tables of migration 0043, per
 *      row; `tracking_devices.first_source_id` (its index `tracking_devices_first_source_idx`, and the column's share of
 *      the dump) and the three watermark indexes on `drop_entries`, `live_entries`, `orders`; the nightly backup
 *      ESTIMATED per table as its COPY text compressed with zlib level 6 (what `pg_dump -Fc -Z6` writes for a table's
 *      data; indexes are not in a dump). The real `pg_dump -Fc -Z6` is the owner's to run (the hand-over).
 *
 * Prints the figures and writes them as JSON (`--json`, default out/acquisition-size.json).
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
import { fillAcquisition } from './acquisition-fill.js';

/** The fill ends here (a morning: the job's window), 13 Paris months after its first day. */
export const FILL_END = new Date('2027-10-08T08:00:00Z');

const TABLES = ['link_channels', 'links', 'acquisition_sources', 'acquisition_touches', 'account_sources', 'acquisition_conversions', 'acquisition_daily', 'acquisition_state'] as const;
const INDEXES = ['tracking_devices_first_source_idx', 'drop_entries_created_idx', 'live_entries_joined_idx', 'orders_reserved_idx'] as const;

interface TableSize {
  rows: number;
  table: number;
  indexes: number;
  total: number;
  dump: number;
}

/**
 * The COPY text of `query`'s rows, compressed with zlib level 6 as `pg_dump -Fc -Z6` compresses a table's data, in bytes
 * (scripts/views-size.ts's measure: on PGlite COPY's own text, by ctid pages; on PostgreSQL the same text rebuilt).
 */
async function dumpBytes(db: Db, pglite: PGlite | null, table: string, columns = '*'): Promise<number> {
  const deflate = createDeflate({ level: 6 });
  let out = 0;
  deflate.on('data', (c: Buffer) => (out += c.length));
  const done = new Promise<void>((ok, ko) => {
    deflate.on('end', ok);
    deflate.on('error', ko);
  });
  const write = (b: Uint8Array) => new Promise<void>((ok) => (deflate.write(b) ? ok() : deflate.once('drain', ok)));
  if (pglite) {
    const pages = Number((await sql<{ n: number }>`SELECT pg_relation_size(${table}::regclass) / current_setting('block_size')::int AS n`.execute(db)).rows[0]?.n ?? 0);
    const step = 4_000;
    for (let p = 0; p <= pages; p += step) {
      const r = await pglite.query(`COPY (SELECT ${columns} FROM ${table} WHERE ctid >= '(${p},0)'::tid AND ctid < '(${p + step},0)'::tid) TO '/dev/blob'`);
      if (r.blob) await write(new Uint8Array(await r.blob.arrayBuffer()));
    }
  } else {
    const cols =
      columns === '*'
        ? (await sql<{ name: string }>`SELECT attname AS name FROM pg_attribute WHERE attrelid = ${table}::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum`.execute(db)).rows.map((r) => r.name)
        : columns.split(',').map((c) => c.trim());
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

const mb = (n: number) => `${(n / 1_048_576).toFixed(2)} MB`;
const per = (n: number, rows: number) => (rows > 0 ? (n / rows).toFixed(1) : '—');

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { dir: { type: 'string' }, json: { type: 'string' } } });
  const pgUrl = process.env.ORBES_TEST_POSTGRES_URL;
  let db: Db;
  let pglite: PGlite | null = null;
  let cleanup: () => Promise<void>;
  if (pgUrl) {
    const admin = createDb(pgUrl);
    const name = `orbes_acquisition_size_${randomBytes(4).toString('hex')}`;
    await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin);
    const u = new URL(pgUrl);
    u.pathname = `/${name}`;
    db = createDb(u.toString(), { statementTimeoutMs: 0 });
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
    cleanup = () => closeDb(db);
  }
  const t0 = Date.now();
  const log = (m: string) => process.stdout.write(`[${((Date.now() - t0) / 1000).toFixed(0)} s] ${m}\n`);
  try {
    const engine = (await sql<{ v: string }>`SELECT version() AS v`.execute(db)).rows[0]!.v;
    log(`engine: ${engine}${pglite ? ' (PGlite)' : ''}`);
    await migrateToLatest(db);
    const fill = await fillAcquisition(db, FILL_END, log);
    await sql`VACUUM ANALYZE`.execute(db);
    const tables = await sizes(db, pglite);
    const devices = fill.rows.tracking_devices!;
    const indexes: Record<string, { rows: number; bytes: number }> = {};
    for (const i of INDEXES) {
      const r = (await sql<{ bytes: number; tbl: string }>`SELECT pg_relation_size(${i}::regclass) AS bytes, (SELECT indrelid::regclass::text FROM pg_index WHERE indexrelid = ${i}::regclass) AS tbl`.execute(db)).rows[0]!;
      indexes[i] = { rows: Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(r.tbl)}`.execute(db)).rows[0]!.n), bytes: Number(r.bytes) };
    }
    // The column's own share of the dump: tracking_devices with it, less without it.
    const withColumn = await dumpBytes(db, pglite, 'tracking_devices', 'id, device_hash, first_seen_at, first_source_id');
    const withoutColumn = await dumpBytes(db, pglite, 'tracking_devices', 'id, device_hash, first_seen_at');
    process.stdout.write(`\n${engine}${pglite ? ' (PGlite)' : ''} — 13 months at the unit (${fill.days} Paris days, ${fill.firstDay} to ${fill.lastDay})\n`);
    process.stdout.write('| Table | Rows | Table | Indexes | Total | Dump (estimate) | B/row table | B/row indexes | B/row total | B/row dump |\n|---|---|---|---|---|---|---|---|---|---|\n');
    for (const [t, v] of Object.entries(tables)) {
      process.stdout.write(`| ${t} | ${v.rows} | ${mb(v.table)} | ${mb(v.indexes)} | ${mb(v.total)} | ${mb(v.dump)} | ${per(v.table, v.rows)} | ${per(v.indexes, v.rows)} | ${per(v.total, v.rows)} | ${per(v.dump, v.rows)} |\n`);
    }
    process.stdout.write('\n| Index | Rows | Bytes | B/row |\n|---|---|---|---|\n');
    for (const [i, v] of Object.entries(indexes)) process.stdout.write(`| ${i} | ${v.rows} | ${mb(v.bytes)} | ${per(v.bytes, v.rows)} |\n`);
    process.stdout.write(`\ntracking_devices.first_source_id in the dump: ${per(withColumn - withoutColumn, devices)} B a device (${devices} devices)\n`);
    const result = { engine: `${engine}${pglite ? ' (PGlite)' : ''}`, fillEnd: FILL_END.toISOString(), fill, tables, indexes, firstSourceDumpPerDevice: (withColumn - withoutColumn) / devices };
    const json = resolve(values.json ?? 'out/acquisition-size.json');
    mkdirSync(dirname(json), { recursive: true });
    writeFileSync(json, `${JSON.stringify(result, null, 2)}\n`);
    log(`written ${json}`);
  } finally {
    await cleanup();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
