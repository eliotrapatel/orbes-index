/**
 * Verification under true parallelism on real PostgreSQL (opt-in).
 *
 *   ORBES_TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/postgres npx vitest run test/verification/postgres.test.ts
 *
 * PGlite has a single connection, so concurrent verifications there are
 * serialised. Here a pool of 8 runs them truly in parallel: the anomaly
 * upserts (ON CONFLICT on the partial unique index, advisory lock for
 * product-less findings) must never fail or duplicate rows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { toBase64Url } from '../../src/core/bytes.js';
import { encodePayload, frameCodeData, signingMessage } from '../../src/core/payload.js';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { createWorld, issue, issueActivated, verify, type World } from './world.js';

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;

describe.skipIf(!adminUrl)('verification on PostgreSQL (pool of 8)', () => {
  let admin: Db;
  let db: Db;
  let w: World;
  const dbName = `orbes_v_${randomBytes(6).toString('hex')}`;

  beforeAll(async () => {
    admin = createDb(adminUrl!);
    await sql`CREATE DATABASE ${sql.id(dbName)}`.execute(admin);
    const u = new URL(adminUrl!);
    u.pathname = `/${dbName}`;
    db = createDb(u.toString(), { poolMax: 8 });
    await migrateToLatest(db);
    w = await createWorld({ db });
  });

  afterAll(async () => {
    if (db) await closeDb(db);
    if (admin) {
      await sql`DROP DATABASE IF EXISTS ${sql.id(dbName)} WITH (FORCE)`.execute(admin);
      await closeDb(admin);
    }
  });

  it('parallel scans of a mass-copied code: no errors, one open anomaly per type', async () => {
    const r = await issueActivated(w);
    const countries = ['FR', 'JP', 'US', 'BR', 'AU'];
    const outs = await Promise.all(
      Array.from({ length: 40 }, (_, i) => verify(w, r.code.data, { deviceHash: `pg-${i}`, geo: { country: countries[i % countries.length] } })),
    );
    expect(outs).toHaveLength(40);
    const rows = await db.selectFrom('anomalies').selectAll().where('product_id', '=', r.product.id).execute();
    const types = rows.map((a) => a.type).sort();
    expect(new Set(types).size).toBe(types.length);
    expect(rows.every((a) => a.status === 'OPEN')).toBe(true);
    const events = await db.selectFrom('authentication_events').select(['state']).where('product_id', '=', r.product.id).execute();
    expect(events).toHaveLength(40);
    expect(events.some((e) => e.state === 'SUSPICIOUS_ACTIVITY')).toBe(true);
  });

  it('parallel public scans of a piece not sold yet (S-07): AUTHENTIC every time, one UNSOLD_PIECE_SCAN of one occurrence', async () => {
    const r = await issue(w);
    const outs = await Promise.all(Array.from({ length: 16 }, (_, i) => verify(w, r.code.data, { deviceHash: `unsold-${i}`, geo: { country: 'FR' } })));
    expect(new Set(outs.map((o) => o.state))).toEqual(new Set(['AUTHENTIC']));
    const rows = await db.selectFrom('anomalies').selectAll().where('product_id', '=', r.product.id).where('type', '=', 'UNSOLD_PIECE_SCAN').execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'OPEN', occurrences: 1, risk_score: 0 });
  });

  it('parallel scans of an unregistered identity record one CRITICAL anomaly with every occurrence', async () => {
    const signer = await w.keys.activeSigner();
    const payload = encodePayload({ codeVersion: 1, genomeVersion: 1, keyId: signer.keyId, identity: { year: 2026, categoryIndex: 1, serial: 44_444 }, issue: 1, issuedDay: 900, nonce: new Uint8Array(4) });
    const code = toBase64Url(frameCodeData(payload, await signer.sign(signingMessage(payload))));
    const outs = await Promise.all(Array.from({ length: 24 }, () => verify(w, code)));
    expect(new Set(outs.map((o) => o.state))).toEqual(new Set(['UNKNOWN']));
    const rows = await db.selectFrom('anomalies').selectAll().where('type', '=', 'VALID_SIGNATURE_UNREGISTERED').execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].occurrences).toBe(24);
  });
});
