import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createTestDb, type TestDb } from '../support/db.js';
import { AUDIT_GENESIS_HASH, AuditService, canonicalJson, computeAuditHash } from '../../src/server/services/audit.js';
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
