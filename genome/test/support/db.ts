/**
 * Test databases: a fresh, fully migrated, in-memory PGlite per call.
 *
 * Booting PGlite runs initdb (several seconds). To keep tests fast, each
 * test process migrates ONE template database, dumps its data directory
 * once, and every createTestDb() restores from that dump (≈1 s). The WASM
 * modules are compiled once per process and shared.
 *
 *   const { db, close } = await createTestDb();
 *   afterAll(() => close());
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite, type PGliteOptions } from '@electric-sql/pglite';
import { closeDb, createDbFromPGlite, PGLITE_PARSERS, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';

export interface TestDb {
  db: Db;
  /** The underlying PGlite instance, for raw SQL in tests (e.g. simulating a compromised DB). */
  pglite: PGlite;
  close(): Promise<void>;
}

type EngineOptions = Pick<PGliteOptions, 'pgliteWasmModule' | 'initdbWasmModule' | 'fsBundle'>;

let engine: Promise<EngineOptions> | undefined;
let template: Promise<Blob> | undefined;

/** Precompiled WASM + filesystem bundle; falls back to PGlite's own loading if the layout changes. */
async function loadEngine(): Promise<EngineOptions> {
  try {
    const dist = dirname(fileURLToPath(import.meta.resolve('@electric-sql/pglite')));
    const [pg, initdb, data] = await Promise.all([
      readFile(join(dist, 'pglite.wasm')),
      readFile(join(dist, 'initdb.wasm')),
      readFile(join(dist, 'pglite.data')),
    ]);
    const [pgliteWasmModule, initdbWasmModule] = await Promise.all([WebAssembly.compile(pg), WebAssembly.compile(initdb)]);
    return { pgliteWasmModule, initdbWasmModule, fsBundle: new Blob([data]) };
  } catch {
    return {};
  }
}

function getEngine(): Promise<EngineOptions> {
  engine ??= loadEngine();
  return engine;
}

async function newPGlite(extra: PGliteOptions = {}): Promise<PGlite> {
  const pglite = new PGlite({ ...(await getEngine()), parsers: PGLITE_PARSERS, relaxedDurability: true, ...extra });
  await pglite.waitReady;
  return pglite;
}

async function buildTemplate(): Promise<Blob> {
  const pglite = await newPGlite();
  const db = createDbFromPGlite(pglite);
  try {
    await migrateToLatest(db);
    return await pglite.dumpDataDir('none');
  } finally {
    await closeDb(db);
  }
}

/**
 * A fresh in-memory database with all migrations applied.
 * Pass `{ migrated: false }` for an empty database (migration tests).
 */
export async function createTestDb(opts: { migrated?: boolean } = {}): Promise<TestDb> {
  let pglite: PGlite;
  if (opts.migrated === false) {
    pglite = await newPGlite();
  } else {
    template ??= buildTemplate().catch((e: unknown) => {
      template = undefined; // let the next caller retry instead of caching the failure
      throw e;
    });
    pglite = await newPGlite({ loadDataDir: await template });
  }
  const db = createDbFromPGlite(pglite);
  let closed = false;
  return {
    db,
    pglite,
    close: async () => {
      if (closed) return;
      closed = true;
      await closeDb(db);
    },
  };
}
