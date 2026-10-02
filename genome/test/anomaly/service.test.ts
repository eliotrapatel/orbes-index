import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ADVISORY_LOCK } from '../../src/server/db/connection.js';
import { ANOMALY_UNREGISTERED_LOCK, AnomalyService, type AnomalyFinding } from '../../src/server/services/anomaly.js';
import { pageRequest } from '../../src/server/types.js';
import { admin, anomalies, createAccount, createWorld, issue, type World } from '../verification/world.js';
import type { IssueResult } from '../../src/server/services/issuance.js';

const MIN = 60_000;

describe('AnomalyService', () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(() => w.close());

  async function scanAt(r: IssueResult, at: Date, extra: { country?: string; device?: string; account?: string } = {}): Promise<string> {
    const row = await w.t.db
      .insertInto('scan_events')
      .values({
        occurred_at: at,
        code_id: r.code.id,
        product_id: r.product.id,
        packed_identity: r.product.packedIdentity,
        event_type: 'VERIFY',
        device_hash: extra.device ?? 'dev',
        account_id: extra.account ?? null,
        country: extra.country ?? null,
        result_state: 'AUTHENTIC',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  const evalAt = async (r: IssueResult, scanEventId: string, accountIsOwner = false) =>
    w.anomaly.evaluate({ productId: r.product.id, codeId: r.code.id, scanEventId, accountIsOwner });

  it('records findings that involve the current scan, and only those', async () => {
    const r = await issue(w);
    const t0 = w.clock.now().getTime();
    await scanAt(r, new Date(t0), { country: 'FR' });
    w.clock.set(t0 + 2 * MIN);
    const s2 = await scanAt(r, new Date(t0 + 2 * MIN), { country: 'JP' });
    const e2 = await evalAt(r, s2);
    expect(e2.riskScore).toBe(60);
    expect(e2.findings.map((f) => f.type)).toEqual(['IMPOSSIBLE_TRAVEL']);
    expect(e2.findings[0]).toMatchObject({ productId: r.product.id, codeId: r.code.id, severity: 'HIGH', weight: 60, riskScore: 60 });

    // A later quiet scan in Japan: the old violation still scores (decayed) but is not recorded again.
    w.clock.set(t0 + 60 * MIN);
    const s3 = await scanAt(r, new Date(t0 + 60 * MIN), { country: 'JP' });
    const e3 = await evalAt(r, s3);
    expect(e3.findings).toHaveLength(1);
    expect(e3.riskScore).toBe(60); // 60 · (1 − 58 min / 30 d) rounds to 60
    const rows = (await anomalies(w)).filter((a) => a.product_id === r.product.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'IMPOSSIBLE_TRAVEL', occurrences: 1, status: 'OPEN' });
    expect(rows[0].details).toMatchObject({ fromCountry: 'FR', toCountry: 'JP', scanEventId: s2, weight: 60 });

    // A new violation increments occurrences.
    w.clock.set(t0 + 61 * MIN);
    const s4 = await scanAt(r, new Date(t0 + 61 * MIN), { country: 'US' });
    await evalAt(r, s4);
    const again = (await anomalies(w)).filter((a) => a.product_id === r.product.id);
    expect(again).toHaveLength(1);
    expect(again[0].occurrences).toBe(2);
    expect(again[0].last_seen_at.getTime()).toBe(t0 + 61 * MIN);
    expect(again[0].first_seen_at.getTime()).toBe(t0 + 2 * MIN);
    w.clock.set(t0);
  });

  it('marks the current owner’s scans so velocity/device rules ignore them', async () => {
    const r = await issue(w);
    const owner = await createAccount(w);
    await w.t.db.insertInto('ownership').values({ product_id: r.product.id, account_id: owner, acquired_via: 'ADMIN', verified: true }).execute();
    const t0 = w.clock.now().getTime();
    let last = '';
    for (let i = 0; i < 25; i++) last = await scanAt(r, new Date(t0 + i * 1000), { device: `d${i}`, account: owner });
    w.clock.set(t0 + 25_000);
    const e = await evalAt(r, last, true);
    expect(e).toEqual({ riskScore: 0, findings: [] });
    w.clock.set(t0);
  });

  it('ignores ADMIN_TEST scans and always includes the current scan', async () => {
    const r = await issue(w);
    const t0 = w.clock.now().getTime();
    await w.t.db
      .insertInto('scan_events')
      .values({ occurred_at: new Date(t0), code_id: r.code.id, product_id: r.product.id, event_type: 'ADMIN_TEST', country: 'FR', result_state: 'AUTHENTIC' })
      .execute();
    // Current scan stamped slightly in the future (clock skew between instances).
    const cur = await scanAt(r, new Date(t0 + 5000), { country: 'JP' });
    const e = await evalAt(r, cur);
    expect(e.findings).toEqual([]);
  });

  it('observeOnly (a staff scan, S-07): the public history scores, the scan itself takes no part and nothing is recorded', async () => {
    const r = await issue(w);
    const t0 = w.clock.now().getTime();
    await scanAt(r, new Date(t0), { country: 'FR' });
    w.clock.set(t0 + 2 * MIN);
    // A staff scan from Japan two minutes later: as a public scan it would be impossible travel.
    const staff = await w.t.db
      .insertInto('scan_events')
      .values({ occurred_at: new Date(t0 + 2 * MIN), code_id: r.code.id, product_id: r.product.id, event_type: 'ADMIN_TEST', country: 'JP', result_state: 'PENDING' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const quiet = await w.anomaly.evaluate({ productId: r.product.id, codeId: r.code.id, scanEventId: staff.id, accountIsOwner: false }, { observeOnly: true });
    expect(quiet).toEqual({ riskScore: 0, findings: [] });

    // Public scans make the history impossible; a staff scan then reads it as a customer would, and adds nothing.
    const pub = await scanAt(r, new Date(t0 + 2 * MIN), { country: 'JP' });
    await evalAt(r, pub);
    w.clock.set(t0 + 3 * MIN);
    const before = (await anomalies(w)).filter((a) => a.product_id === r.product.id);
    expect(before.map((a) => [a.type, a.occurrences])).toEqual([['IMPOSSIBLE_TRAVEL', 1]]);
    const staff2 = await w.t.db
      .insertInto('scan_events')
      .values({ occurred_at: new Date(t0 + 3 * MIN), code_id: r.code.id, product_id: r.product.id, event_type: 'ADMIN_TEST', country: 'US', result_state: 'PENDING' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const seen = await w.anomaly.evaluate({ productId: r.product.id, codeId: r.code.id, scanEventId: staff2.id, accountIsOwner: false }, { observeOnly: true });
    expect(seen.riskScore).toBe(60);
    expect(seen.findings.map((f) => f.type)).toEqual(['IMPOSSIBLE_TRAVEL']);
    expect((await anomalies(w)).filter((a) => a.product_id === r.product.id)).toEqual(before);
    w.clock.set(t0);
  });

  it('validates its input', async () => {
    const r = await issue(w);
    await expect(w.anomaly.evaluate({ productId: 'x', codeId: r.code.id, scanEventId: randomUUID(), accountIsOwner: false })).rejects.toThrow(TypeError);
    const other = await issue(w);
    await expect(
      w.anomaly.evaluate({ productId: other.product.id, codeId: r.code.id, scanEventId: randomUUID(), accountIsOwner: false }),
    ).rejects.toThrow(/does not belong/);
  });

  describe('recordFinding', () => {
    const finding = (over: Partial<AnomalyFinding>): AnomalyFinding => ({
      type: 'GENOME_MISMATCH',
      severity: 'HIGH',
      weight: 60,
      riskScore: 40,
      productId: null,
      codeId: null,
      at: w.clock.now(),
      details: {},
      ...over,
    });

    it('upserts per product and type, keeping the max risk score and the latest details', async () => {
      const r = await issue(w);
      const t0 = w.clock.now().getTime();
      await w.anomaly.recordFinding(finding({ productId: r.product.id, codeId: r.code.id, riskScore: 40, details: { n: 1 } }));
      await w.anomaly.recordFinding(finding({ productId: r.product.id, codeId: r.code.id, riskScore: 20, at: new Date(t0 + 1000), details: { n: 2 } }));
      const rows = (await anomalies(w)).filter((a) => a.product_id === r.product.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ occurrences: 2, risk_score: 40, details: { n: 2 } });
      expect(rows[0].last_seen_at.getTime()).toBe(t0 + 1000);
    });

    it('deduplicates product-less findings by packed identity', async () => {
      const f = (packedIdentity: number) =>
        finding({ type: 'VALID_SIGNATURE_UNREGISTERED', severity: 'CRITICAL', riskScore: 100, details: { packedIdentity } });
      await w.anomaly.recordFinding(f(111));
      await w.anomaly.recordFinding(f(111));
      await w.anomaly.recordFinding(f(222));
      const rows = (await anomalies(w)).filter((a) => a.type === 'VALID_SIGNATURE_UNREGISTERED');
      expect(rows.map((a) => [a.details.packedIdentity, a.occurrences]).sort()).toEqual([
        [111, 2],
        [222, 1],
      ]);
    });

    it('a resolved anomaly is not reopened by a new finding: a new OPEN row starts', async () => {
      const r = await issue(w);
      await w.anomaly.recordFinding(finding({ productId: r.product.id }));
      const [row] = (await anomalies(w)).filter((a) => a.product_id === r.product.id);
      await w.anomaly.updateStatus(row.id, { status: 'RESOLVED', note: 'reviewed' }, admin);
      await w.anomaly.recordFinding(finding({ productId: r.product.id }));
      const rows = (await anomalies(w)).filter((a) => a.product_id === r.product.id);
      expect(rows.map((a) => a.status).sort()).toEqual(['OPEN', 'RESOLVED']);
      // Reopening the resolved one would create a second open anomaly of the same type.
      await expect(w.anomaly.updateStatus(row.id, { status: 'OPEN' }, admin)).rejects.toMatchObject({ code: 'ANOMALY_ALREADY_OPEN', httpStatus: 409 });
    });

    it('oncePerUtcDay (S-07): one occurrence per product and UTC day, in any status, even against a concurrent recording', async () => {
      const r = await issue(w);
      const day = Date.parse('2026-06-03T00:00:00.000Z');
      const unsold = (at: number, details: Record<string, string> = {}) =>
        finding({ type: 'UNSOLD_PIECE_SCAN', severity: 'MEDIUM', weight: 0, riskScore: 0, productId: r.product.id, codeId: r.code.id, at: new Date(at), details });
      const rows = async () => (await anomalies(w)).filter((a) => a.product_id === r.product.id);

      await w.anomaly.recordFinding(unsold(day + 9 * 60 * MIN, { country: 'FR' }), undefined, { oncePerUtcDay: true });
      // Later the same day, twice at once: neither adds an occurrence (PostgreSQL races: test/verification/postgres.test.ts).
      await Promise.all([
        w.anomaly.recordFinding(unsold(day + 15 * 60 * MIN, { country: 'IT' }), undefined, { oncePerUtcDay: true }),
        w.anomaly.recordFinding(unsold(day + 23 * 60 * MIN + 59 * MIN, { country: 'DE' }), undefined, { oncePerUtcDay: true }),
      ]);
      let [row] = await rows();
      expect(row).toMatchObject({ type: 'UNSOLD_PIECE_SCAN', status: 'OPEN', occurrences: 1, risk_score: 0, details: { country: 'FR' } });
      expect(row.last_seen_at.getTime()).toBe(day + 9 * 60 * MIN);

      // The next UTC day counts once more: occurrences count days.
      await w.anomaly.recordFinding(unsold(day + 24 * 60 * MIN + MIN, { country: 'ES' }), undefined, { oncePerUtcDay: true });
      await w.anomaly.recordFinding(unsold(day + 30 * 60 * MIN, { country: 'GB' }), undefined, { oncePerUtcDay: true });
      [row] = await rows();
      expect(row).toMatchObject({ occurrences: 2, details: { country: 'ES' } });
      expect(row.first_seen_at.getTime()).toBe(day + 9 * 60 * MIN);

      // Dismissed that day: not raised again before the next day, then a new OPEN row starts.
      await w.anomaly.updateStatus(row.id, { status: 'DISMISSED', note: 'stock check' }, admin);
      await w.anomaly.recordFinding(unsold(day + 47 * 60 * MIN), undefined, { oncePerUtcDay: true });
      expect((await rows()).map((a) => a.status)).toEqual(['DISMISSED']);
      await w.anomaly.recordFinding(unsold(day + 48 * 60 * MIN, { country: 'FR' }), undefined, { oncePerUtcDay: true });
      expect((await rows()).map((a) => [a.status, a.occurrences]).sort()).toEqual([
        ['DISMISSED', 2],
        ['OPEN', 1],
      ]);

      // Without a product there is no day to count.
      await expect(w.anomaly.recordFinding({ ...unsold(day), productId: null }, undefined, { oncePerUtcDay: true })).rejects.toThrow(TypeError);
    });

    it('rejects malformed findings', async () => {
      await expect(w.anomaly.recordFinding(finding({ type: 'lower' }))).rejects.toThrow(TypeError);
      await expect(w.anomaly.recordFinding(finding({ severity: 'SEVERE' as never }))).rejects.toThrow(TypeError);
      await expect(w.anomaly.recordFinding(finding({ productId: 'nope' }))).rejects.toThrow(TypeError);
      await expect(w.anomaly.recordFinding(finding({ at: new Date(Number.NaN) }))).rejects.toThrow(TypeError);
    });
  });

  describe('admin triage', () => {
    it('lists with filters and pagination, gets by id, updates status with an audit entry', async () => {
      const r = await issue(w);
      await w.anomaly.recordFinding({
        type: 'CODE_MISMATCH',
        severity: 'CRITICAL',
        weight: 100,
        riskScore: 100,
        productId: r.product.id,
        codeId: r.code.id,
        at: w.clock.now(),
        details: { issue: 1 },
      });
      const page = await w.anomaly.list({ severity: 'CRITICAL', productId: r.product.productId }, pageRequest({ pageSize: 10 }));
      expect(page.total).toBe(1);
      expect(page.items[0]).toMatchObject({ type: 'CODE_MISMATCH', productId: r.product.productId, productUuid: r.product.id, status: 'OPEN' });
      const byUuid = await w.anomaly.list({ productId: r.product.id }, pageRequest());
      expect(byUuid.total).toBe(1);
      const all = await w.anomaly.list({}, pageRequest({ pageSize: 2 }));
      expect(all.items).toHaveLength(2);
      expect(all.total).toBeGreaterThan(2);

      const id = page.items[0].id;
      expect((await w.anomaly.get(id)).id).toBe(id);
      const ack = await w.anomaly.updateStatus(id, { status: 'ACKNOWLEDGED' }, admin);
      expect(ack).toMatchObject({ status: 'ACKNOWLEDGED', resolvedBy: null, resolvedAt: null });
      const done = await w.anomaly.updateStatus(id, { status: 'DISMISSED', note: 'test print' }, admin);
      expect(done).toMatchObject({ status: 'DISMISSED', resolvedBy: 'admin:admin-1', resolutionNote: 'test print' });
      expect(done.resolvedAt).toEqual(w.clock.now());
      const audit = await w.t.db.selectFrom('audit_logs').selectAll().where('action', '=', 'anomaly.update').where('target_id', '=', id).execute();
      expect(audit.map((a) => a.details.to)).toEqual(['ACKNOWLEDGED', 'DISMISSED']);
    });

    it('validates filters and ids', async () => {
      await expect(w.anomaly.list({ status: 'NOPE' as never }, pageRequest())).rejects.toMatchObject({ httpStatus: 400 });
      await expect(w.anomaly.list({ severity: 'NOPE' as never }, pageRequest())).rejects.toMatchObject({ httpStatus: 400 });
      await expect(w.anomaly.get('nope')).rejects.toMatchObject({ httpStatus: 404 });
      await expect(w.anomaly.get(randomUUID())).rejects.toMatchObject({ code: 'ANOMALY_NOT_FOUND' });
      await expect(w.anomaly.updateStatus(randomUUID(), { status: 'RESOLVED' }, admin)).rejects.toMatchObject({ httpStatus: 404 });
      await expect(w.anomaly.updateStatus(randomUUID(), { status: 'BAD' as never }, admin)).rejects.toMatchObject({ httpStatus: 400 });
      await expect(w.anomaly.updateStatus(randomUUID(), { status: 'RESOLVED', note: 'x'.repeat(2001) }, admin)).rejects.toMatchObject({ httpStatus: 400 });
    });
  });

  it('re-exports AnomalyConfig and works with a tiny history limit', async () => {
    const svc = new AnomalyService({ db: w.t.db, config: w.config.anomaly, clock: w.clock.now, historyLimit: 10 });
    const r = await issue(w);
    const t0 = w.clock.now().getTime();
    for (let i = 0; i < 15; i++) await scanAt(r, new Date(t0 - 15 * MIN + i * MIN), { country: 'FR' });
    const cur = await scanAt(r, new Date(t0), { country: 'FR' });
    const e = await svc.evaluate({ productId: r.product.id, codeId: r.code.id, scanEventId: cur, accountIsOwner: false });
    expect(e.riskScore).toBe(0);
  });

  it('the product-less finding lock lives in the shared ADVISORY_LOCK namespace', () => {
    expect(ADVISORY_LOCK.ANOMALY_UNREGISTERED).toBe(0x4f52_0101);
    expect(ANOMALY_UNREGISTERED_LOCK).toBe(ADVISORY_LOCK.ANOMALY_UNREGISTERED);
    const values = Object.values(ADVISORY_LOCK);
    expect(new Set(values).size).toBe(values.length);
  });
});
