import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createTestDb, type TestDb } from '../support/db.js';
import { CompiledQuery } from 'kysely';
import { AUDIT_GENESIS_HASH, AuditService, canonicalJson, chainBatch, computeAuditHash } from '../../src/server/services/audit.js';
import { DomainError } from '../../src/server/errors.js';
import { isGuardViolation } from '../../src/server/db/pg-errors.js';
import { createManualClock, type Actor } from '../../src/server/types.js';
import { toHex } from '../../src/core/bytes.js';

const admin: Actor = { type: 'admin', id: 'a6c1a0b2-0000-4000-8000-000000000001', ipHash: 'iphash-1' };
const system: Actor = { type: 'system' };

describe('canonicalJson', () => {
  it('sorts keys recursively, drops undefined, adds no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: null, y: 'é' }], c: true }, u: undefined })).toBe(
      '{"a":{"c":true,"d":[3,{"y":"é","z":null}]},"b":1}',
    );
    expect(canonicalJson('x"\n')).toBe('"x\\"\\n"');
    expect(canonicalJson([1.5, -0, 1e21])).toBe('[1.5,0,1e+21]');
  });

  it('refuses values JSON cannot represent', () => {
    expect(() => canonicalJson(NaN)).toThrow(TypeError);
    expect(() => canonicalJson({ a: Infinity })).toThrow(TypeError);
    expect(() => canonicalJson(1n)).toThrow(TypeError);
    expect(() => canonicalJson(() => 1)).toThrow(TypeError);
  });
});

describe('AuditService', () => {
  let t: TestDb;
  let audit: AuditService;
  const clock = createManualClock('2026-06-01T10:00:00.000Z');

  beforeAll(async () => {
    t = await createTestDb();
    audit = new AuditService({ db: t.db, clock: clock.now });
  });
  afterAll(() => t.close());

  it('starts with an empty, valid chain', async () => {
    expect(await audit.verifyChain()).toEqual({ ok: true, checked: 0 });
    expect(await audit.head()).toBeNull();
  });

  it('chains entries from the genesis hash with the documented formula', async () => {
    const e1 = await audit.record({
      actor: admin,
      action: 'category.create',
      targetType: 'category',
      targetId: 'J',
      details: { index: 1, name: 'JEWELRY', when: new Date('2026-01-02T03:04:05.006Z'), raw: new Uint8Array([1, 2]) },
    });
    clock.advance(1500);
    const e2 = await audit.record({ actor: system, action: 'key.rotate' });

    expect(e1.prevHash).toBe(toHex(AUDIT_GENESIS_HASH));
    expect(e2.prevHash).toBe(e1.hash);
    expect(e2.id).toBeGreaterThan(e1.id);
    expect(e1.occurredAt.toISOString()).toBe('2026-06-01T10:00:00.000Z');
    expect(e1.details).toEqual({ index: 1, name: 'JEWELRY', when: '2026-01-02T03:04:05.006Z', raw: '0102' });
    expect(e2.details).toEqual({});
    expect(e1.ipHash).toBe('iphash-1');

    // Independent recomputation, exactly as an external auditor would from a SQL export.
    const canonical =
      `{"action":"category.create","actor_id":"${admin.id}","actor_type":"admin",` +
      `"details":{"index":1,"name":"JEWELRY","raw":"0102","when":"2026-01-02T03:04:05.006Z"},` +
      `"id":${e1.id},"ip_hash":"iphash-1","occurred_at":"2026-06-01T10:00:00.000Z","target_id":"J","target_type":"category"}`;
    const expected = createHash('sha256').update(AUDIT_GENESIS_HASH).update(canonical, 'utf8').digest('hex');
    expect(e1.hash).toBe(expected);

    expect(await audit.verifyChain()).toEqual({ ok: true, checked: 2 });
    expect(await audit.head()).toEqual({ id: e2.id, hash: e2.hash });
  });

  it('hashes exactly what the database stores (round-trip of awkward values)', async () => {
    const e = await audit.record({
      actor: { type: 'account', id: 'acc-\u0000-1' },
      action: 'ownership.register',
      targetType: 'product',
      targetId: 'O26-J-00184',
      details: {
        nul: 'a\u0000b',
        lone: 'x\uD800y',
        emoji: '💍',
        nested: { z: [1, 0.1, 1e-7, 12345678901234567890, -0, null, undefined], b: false },
        big: 2n ** 70n,
        skip: undefined,
        fn: () => 1,
      },
    });
    expect(e.actorId).toBe('acc-�-1');
    expect(e.details).toEqual({
      nul: 'a�b',
      lone: 'x�y',
      emoji: '💍',
      nested: { z: [1, 0.1, 1e-7, 12345678901234567890, 0, null, null], b: false },
      big: '1180591620717411303424',
    });
    const page = await audit.list({ targetId: 'O26-J-00184' });
    expect(page.items[0].details).toEqual(e.details);
    expect(page.items[0].hash).toBe(e.hash);
    expect((await audit.verifyChain()).ok).toBe(true);
  });

  it('validates input', async () => {
    await expect(audit.record({ actor: { type: 'root' as 'admin' }, action: 'x.y' })).rejects.toBeInstanceOf(DomainError);
    await expect(audit.record({ actor: system, action: 'drop table;' })).rejects.toBeInstanceOf(DomainError);
    await expect(audit.record({ actor: system, action: '' })).rejects.toBeInstanceOf(DomainError);
    await expect(audit.record({ actor: system, action: 'a.b', details: [] as unknown as Record<string, unknown> })).rejects.toBeInstanceOf(
      DomainError,
    );
    await expect(audit.record({ actor: system, action: 'a.b', details: { n: NaN } })).rejects.toBeInstanceOf(DomainError);
    await expect(audit.record({ actor: system, action: 'a.b', targetId: 'x'.repeat(501) })).rejects.toBeInstanceOf(DomainError);
    await expect(audit.record({ actor: system, action: 'a.b', details: { blob: 'x'.repeat(70_000) } })).rejects.toBeInstanceOf(DomainError);
    expect((await audit.verifyChain()).ok).toBe(true);
  });

  it('keeps the chain linear under concurrent appends', async () => {
    const before = (await audit.verifyChain()).checked;
    const n = 25;
    const results = await Promise.all(
      Array.from({ length: n }, (_, i) => audit.record({ actor: system, action: 'test.concurrent', details: { i } })),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(n);
    expect(new Set(results.map((r) => r.prevHash)).size).toBe(n);
    const v = await audit.verifyChain({ batchSize: 7 }); // small batches exercise keyset paging
    expect(v).toEqual({ ok: true, checked: before + n });
  });

  it('appends many entries at once in their order, linked as one by one, beside concurrent single appends (recordAll)', async () => {
    const before = (await audit.verifyChain()).checked;
    const head = await audit.head();
    const n = 1_203; // more than two of its insert statements
    const many = Array.from({ length: n }, (_, i) => ({ actor: system, action: 'test.batch', targetType: 'account', targetId: `a-${i}`, details: { i } }));
    await Promise.all([
      t.db.transaction().execute((trx) => audit.recordAll(many, trx)),
      ...Array.from({ length: 5 }, (_, i) => audit.record({ actor: system, action: 'test.beside', details: { i } })),
    ]);
    const rows = await t.db.selectFrom('audit_logs').select(['id', 'target_id', 'details']).where('action', '=', 'test.batch').orderBy('id').execute();
    expect(rows.map((r) => r.target_id)).toEqual(many.map((m) => m.targetId));
    expect(rows.map((r) => (r.details as { i: number }).i)).toEqual(many.map((m) => m.details.i));
    expect(await audit.verifyChain({ batchSize: 500 })).toEqual({ ok: true, checked: before + n + 5 });
    // An entry refused refuses the whole batch, nothing written.
    const now = await audit.head();
    expect(now).not.toEqual(head);
    await expect(audit.recordAll([{ actor: system, action: 'test.ok' }, { actor: system, action: 'drop table;' }])).rejects.toBeInstanceOf(DomainError);
    expect(await audit.head()).toEqual(now);
  });

  it('commits and rolls back with the caller transaction', async () => {
    const head = await audit.head();
    await expect(
      t.db.transaction().execute(async (trx) => {
        await audit.record({ actor: system, action: 'test.rolled_back' }, trx);
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await audit.head()).toEqual(head);

    const inside = await t.db.transaction().execute((trx) => audit.record({ actor: system, action: 'test.committed' }, trx));
    expect(inside.prevHash).toBe(head!.hash);
    expect((await audit.verifyChain()).ok).toBe(true);
  });

  it('cannot be modified through the application connection', async () => {
    await expect(t.db.updateTable('audit_logs').set({ action: 'x.y' }).execute()).rejects.toSatisfy(isGuardViolation);
    await expect(t.db.deleteFrom('audit_logs').execute()).rejects.toSatisfy(isGuardViolation);
  });

  it('lists newest first with filters and pagination', async () => {
    const all = await audit.list({}, { page: 1, pageSize: 5 });
    expect(all.items).toHaveLength(5);
    expect(all.total).toBeGreaterThan(25);
    expect(all.items[0].id).toBeGreaterThan(all.items[1].id);
    const p2 = await audit.list({}, { page: 2, pageSize: 5 });
    expect(p2.items[0].id).toBeLessThan(all.items[4].id);

    const concurrent = await audit.list({ action: 'test.concurrent' }, { page: 1, pageSize: 200 });
    expect(concurrent.total).toBe(25);
    expect(concurrent.items.every((e) => e.action === 'test.concurrent')).toBe(true);

    expect((await audit.list({ actorType: 'admin' })).items.map((e) => e.action)).toEqual(['category.create']);
    expect((await audit.list({ actorId: admin.id })).total).toBe(1);
    expect((await audit.list({ targetType: 'category', targetId: 'J' })).total).toBe(1);
    const window = await audit.list({ from: new Date('2026-06-01T10:00:00.000Z'), to: new Date('2026-06-01T10:00:01.000Z') });
    expect(window.items.map((e) => e.action)).toEqual(['category.create']);
  });
});

describe('AuditService tamper detection (simulated database compromise)', () => {
  let t: TestDb;
  let audit: AuditService;
  const ids: number[] = [];

  beforeAll(async () => {
    t = await createTestDb();
    const clock = createManualClock('2026-07-01T00:00:00.000Z');
    audit = new AuditService({ db: t.db, clock: clock.now });
    for (let i = 0; i < 6; i++) {
      clock.advance(1000);
      ids.push((await audit.record({ actor: system, action: 'test.entry', details: { i } })).id);
    }
    expect(await audit.verifyChain()).toEqual({ ok: true, checked: 6 });
  });
  afterAll(() => t.close());

  /** An attacker with raw SQL access disables the guard trigger, edits, and re-enables it. */
  async function compromised(statement: string, params: unknown[] = []) {
    await t.pglite.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only');
    try {
      await t.pglite.query(statement, params);
    } finally {
      await t.pglite.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only');
    }
  }

  it('detects an edited entry', async () => {
    await compromised(`UPDATE audit_logs SET details = '{"i":99}' WHERE id = $1`, [ids[2]]);
    expect(await audit.verifyChain()).toEqual({ ok: false, checked: 2, firstBadId: ids[2] });
    await compromised(`UPDATE audit_logs SET details = '{"i":2}' WHERE id = $1`, [ids[2]]);
    expect((await audit.verifyChain()).ok).toBe(true);
  });

  it('detects an edit whose hash was recomputed (the successor link breaks)', async () => {
    const row = (await t.pglite.query<{ prev_hash: Uint8Array; occurred_at: Date }>(
      'SELECT prev_hash, occurred_at FROM audit_logs WHERE id = $1',
      [ids[1]],
    )).rows[0];
    const forged = computeAuditHash(row.prev_hash, {
      id: ids[1],
      occurredAt: row.occurred_at,
      actorType: 'system',
      actorId: null,
      action: 'test.entry',
      targetType: null,
      targetId: null,
      details: { i: 1000 },
      ipHash: null,
    });
    // UNIQUE(hash) must not trip: the forged hash is new.
    await compromised(`UPDATE audit_logs SET details = '{"i":1000}', hash = $1 WHERE id = $2`, [forged, ids[1]]);
    expect(await audit.verifyChain()).toEqual({ ok: false, checked: 2, firstBadId: ids[2] });
  });

  it('detects a deleted entry', async () => {
    const t2 = await createTestDb();
    try {
      const a2 = new AuditService({ db: t2.db, clock: createManualClock().now });
      const e = [];
      for (let i = 0; i < 4; i++) e.push(await a2.record({ actor: system, action: 'test.entry', details: { i } }));
      await t2.pglite.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only');
      await t2.pglite.query('DELETE FROM audit_logs WHERE id = $1', [e[1].id]);
      await t2.pglite.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only');
      expect(await a2.verifyChain()).toEqual({ ok: false, checked: 1, firstBadId: e[2].id });
    } finally {
      await t2.close();
    }
  });
});

/**
 * The chain check over the test purge's tombstones (plan PURGE §A.5, D14, A5, G15): `audit_logs` and `audit_purge_gaps`
 * merged in id order, each batch read in one statement. A purge is simulated here exactly as the purge's batch function
 * deletes audit rows (migration 0066): one statement deleting the rows under the purge's guard bypass and writing each
 * one's tombstone through a data-modifying CTE. PGlite connects as a superuser, as the definer function runs.
 */
describe('AuditService.verifyChain over the purge\'s tombstones', () => {
  const clock = createManualClock('2026-10-01T09:00:00.000Z');

  async function chainOf(n: number): Promise<{ t: TestDb; audit: AuditService; ids: number[] }> {
    const t = await createTestDb();
    const audit = new AuditService({ db: t.db, clock: clock.now });
    const ids: number[] = [];
    for (let i = 0; i < n; i++) {
      clock.advance(1000);
      ids.push((await audit.record({ actor: system, action: 'test.entry', details: { i } })).id);
    }
    return { t, audit, ids };
  }

  /** One purge batch: the rows deleted and their tombstones written in one statement, as orbes_purge_test_run_batch does. */
  async function purge(t: TestDb, ids: readonly number[]): Promise<void> {
    const list = ids.map((id) => String(Math.trunc(id))).join(',');
    await t.pglite.transaction(async (tx) => {
      await tx.query(`SET LOCAL orbes.guard_bypass = 'purge'`);
      await tx.query(
        `WITH d AS (DELETE FROM audit_logs WHERE id = ANY (ARRAY[${list}]::bigint[]) RETURNING id, prev_hash, hash)
         INSERT INTO audit_purge_gaps (id, prev_hash, hash, run_id) SELECT id, prev_hash, hash, NULL FROM d`,
      );
    });
  }

  /** Raw SQL past the guards, as the tamper tests above do: an attacker, never the app. */
  async function compromised(t: TestDb, statement: string, params: unknown[] = []): Promise<void> {
    await t.pglite.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only');
    try {
      await t.pglite.query(statement, params);
    } finally {
      await t.pglite.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only');
    }
  }

  it('keeps the exact verdict of a chain without tombstones: no purged count, whatever the batch size', async () => {
    const { t, audit, ids } = await chainOf(9);
    try {
      for (const batchSize of [1, 2, 3, 4, 9, 10, 1000]) {
        const v = await audit.verifyChain({ batchSize });
        expect(v).toEqual({ ok: true, checked: 9 });
        expect(v).not.toHaveProperty('purged');
      }
      await compromised(t, `UPDATE audit_logs SET details = '{"i":99}' WHERE id = $1`, [ids[4]]);
      const bad = await audit.verifyChain({ batchSize: 2 });
      expect(bad).toEqual({ ok: false, checked: 4, firstBadId: ids[4] });
      expect(bad).not.toHaveProperty('purged');
    } finally {
      await t.close();
    }
  });

  it('steps over tombstones (first, inside and in runs) whose links hold, counts them and keeps the chain OK at every batch size; record() and head() link as before', async () => {
    const { t, audit, ids } = await chainOf(12);
    try {
      await purge(t, [ids[0]!, ids[3]!, ids[4]!, ids[5]!, ids[8]!]);
      for (const batchSize of [1, 2, 3, 5, 7, 12, 1000]) {
        expect(await audit.verifyChain({ batchSize })).toEqual({ ok: true, checked: 7, purged: 5 });
      }
      // The tail is never purged: the head is the newest live entry, and the next entry links to it.
      expect((await audit.head())!.id).toBe(ids[11]);
      const next = await audit.record({ actor: system, action: 'test.after_purge' });
      expect(next.prevHash).toBe((await t.pglite.query<{ h: string }>(`SELECT encode(hash, 'hex') AS h FROM audit_logs WHERE id = $1`, [ids[11]])).rows[0]!.h);
      expect(await audit.verifyChain({ batchSize: 4 })).toEqual({ ok: true, checked: 8, purged: 5 });
      expect(await audit.head()).toEqual({ id: next.id, hash: next.hash });
    } finally {
      await t.close();
    }
  });

  it('is BROKEN at the next entry when an entry is missing with no tombstone, tombstones before it counted', async () => {
    const { t, audit, ids } = await chainOf(8);
    try {
      await purge(t, [ids[1]!]);
      await compromised(t, 'DELETE FROM audit_logs WHERE id = $1', [ids[4]]);
      for (const batchSize of [1, 3, 1000]) {
        expect(await audit.verifyChain({ batchSize })).toEqual({ ok: false, checked: 3, firstBadId: ids[5], purged: 1 });
      }
    } finally {
      await t.close();
    }
  });

  it('is BROKEN at a tombstone whose id is also a live entry, wherever a batch ends', async () => {
    const { t, audit, ids } = await chainOf(6);
    try {
      // A tombstone copied from a live entry (the entry not deleted): same id in both tables.
      await t.pglite.query(`INSERT INTO audit_purge_gaps (id, prev_hash, hash) SELECT id, prev_hash, hash FROM audit_logs WHERE id = $1`, [ids[2]]);
      for (const batchSize of [1, 2, 3, 4, 1000]) {
        expect(await audit.verifyChain({ batchSize })).toEqual({ ok: false, checked: 2, firstBadId: ids[2] });
      }
    } finally {
      await t.close();
    }
  });

  it('is BROKEN at a tombstone that does not link, and at the entry after a tombstone whose hash is forged', async () => {
    const a = await chainOf(5);
    try {
      // A tombstone inserted where no entry was deleted: its prev_hash is not the running hash.
      const free = (await a.t.pglite.query<{ id: number }>(`SELECT (max(id) + 100)::int AS id FROM audit_logs`)).rows[0]!.id;
      await a.t.pglite.query(`INSERT INTO audit_purge_gaps (id, prev_hash, hash) VALUES ($1, sha256('not a link'), sha256('x'))`, [free]);
      expect(await a.audit.verifyChain({ batchSize: 2 })).toEqual({ ok: false, checked: 5, firstBadId: free });
    } finally {
      await a.t.close();
    }
    const b = await chainOf(5);
    try {
      // An entry deleted and replaced by a tombstone with the right link but a made-up hash: the next entry does not link.
      await b.t.pglite.transaction(async (tx) => {
        await tx.query(`SET LOCAL orbes.guard_bypass = 'purge'`);
        await tx.query(
          `WITH d AS (DELETE FROM audit_logs WHERE id = $1 RETURNING id, prev_hash)
           INSERT INTO audit_purge_gaps (id, prev_hash, hash) SELECT id, prev_hash, sha256('forged') FROM d`,
          [b.ids[2]],
        );
      });
      expect(await b.audit.verifyChain({ batchSize: 3 })).toEqual({ ok: false, checked: 2, firstBadId: b.ids[3], purged: 1 });
    } finally {
      await b.t.close();
    }
  });

  it('is BROKEN at a tombstone after the newest live entry (the chain\'s tail deleted, which the purge never does)', async () => {
    const { t, audit, ids } = await chainOf(4);
    try {
      await purge(t, [ids[3]!]);
      for (const batchSize of [1, 3, 1000]) {
        expect(await audit.verifyChain({ batchSize })).toEqual({ ok: false, checked: 3, firstBadId: ids[3], purged: 1 });
      }
    } finally {
      await t.close();
    }
  });

  it('reads a batch in time bounded by the batch, whatever the log\'s size or the cursor\'s depth (index walks and probes, never a scan or sort of a table)', async () => {
    // A large seeded log (the hashes do not chain: only the batch statement's plan is read here), one tombstone in 40.
    const t = await createTestDb();
    try {
      const size = 40_000;
      await t.pglite.query(`INSERT INTO audit_logs (id, occurred_at, actor_type, action, prev_hash, hash)
        SELECT i, now(), 'system', 'test.seed', sha256(int8send(i - 1)), sha256(int8send(i)) FROM generate_series(1, ${size}) i WHERE i % 40 <> 0`);
      await t.pglite.query(`INSERT INTO audit_purge_gaps (id, prev_hash, hash) SELECT i, sha256(int8send(i - 1)), sha256(int8send(i)) FROM generate_series(40, ${size}, 40) i`);
      await t.pglite.query('ANALYZE audit_logs');
      await t.pglite.query('ANALYZE audit_purge_gaps');
      type PlanNode = Record<string, unknown> & { Plans?: PlanNode[] };
      const n = 500;
      for (const afterId of [0, size / 2, size - 2 * n]) {
        const q = chainBatch(afterId, n).compile(t.db);
        const r = await t.db.executeQuery<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(CompiledQuery.raw(`EXPLAIN (ANALYZE, FORMAT JSON) ${q.sql}`, [...q.parameters]));
        const nodes: PlanNode[] = [];
        const walk = (node: PlanNode): void => {
          nodes.push(node);
          for (const child of node.Plans ?? []) walk(child);
        };
        walk(r.rows[0]!['QUERY PLAN'][0]!.Plan);
        const reads = nodes.filter((x) => x['Relation Name'] === 'audit_logs' || x['Relation Name'] === 'audit_purge_gaps');
        expect(reads.length).toBe(4);
        for (const x of reads) expect(['Index Scan', 'Index Only Scan']).toContain(x['Node Type']);
        expect(nodes.filter((x) => String(x['Node Type']).includes('Sort'))).toEqual([]);
        // Each leaf reads at most n entries of its own table and one probe per entry of the other: about 2n, never the log.
        const touched = reads.reduce((sum, x) => sum + Number(x['Actual Rows']) * Number(x['Actual Loops']), 0);
        expect(touched).toBeLessThanOrEqual(2 * n);
        const batch = await chainBatch(afterId, n).execute(t.db);
        expect(batch.rows.length).toBe(n);
        expect(batch.rows.map((x) => Number(x.id))).toEqual(Array.from({ length: n }, (_, i) => afterId + 1 + i));
        expect(batch.rows.filter((x) => x.gap).map((x) => Number(x.id) % 40)).toEqual(batch.rows.filter((x) => x.gap).map(() => 0));
        expect(batch.rows.some((x) => x.shadowed)).toBe(false);
      }
    } finally {
      await t.close();
    }
  });

  it('reads each batch in one statement: a purge batch committed between two verifyChain batches leaves the verdict OK, at every cursor', async () => {
    const n = 15;
    const batchSize = 3;
    for (let at = 1; at * batchSize < n; at++) {
      const { t, audit, ids } = await chainOf(n);
      try {
        let calls = 0;
        let purgedAbove = 0;
        let purgedBelow = 0;
        const v = await audit.verifyChain({
          batchSize,
          betweenBatches: async (afterId) => {
            calls++;
            if (calls !== at) return;
            // The purge deletes rows on both sides of the cursor in one batch: those below were already checked live,
            // those above turn into tombstones the next statement sees with their neighbours, consistently.
            const below = ids.filter((id) => id <= afterId).slice(-2, -1);
            const above = ids.filter((id) => id > afterId).filter((_, i) => i % 2 === 0).filter((id) => id !== ids[n - 1]);
            purgedBelow = below.length;
            purgedAbove = above.length;
            await purge(t, [...below, ...above]);
          },
        });
        expect(calls).toBeGreaterThanOrEqual(at);
        expect(purgedAbove).toBeGreaterThan(0);
        expect(v).toEqual({ ok: true, checked: n - purgedAbove, purged: purgedAbove });
        // Read again after the purge: every purged entry is now a tombstone.
        expect(await audit.verifyChain({ batchSize })).toEqual({ ok: true, checked: n - purgedAbove - purgedBelow, purged: purgedAbove + purgedBelow });
      } finally {
        await t.close();
      }
    }
  });
});
