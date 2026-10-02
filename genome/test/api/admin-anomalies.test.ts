/**
 * Actionable anomalies (A-04): the list's type, product and order filters,
 * the scans registry's time window, the badge's summary and the scans around
 * one finding (GET /api/admin/anomalies/:id/context).
 */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toBase64Url } from '../../src/core/bytes.js';
import { encodePayload, frameCodeData, issuedDayFromDate, signingMessage } from '../../src/core/payload.js';
import type { AnomalySeverity } from '../../src/server/db/schema.js';
import { ANOMALY_TYPES, ANOMALY_WEIGHTS, CONTEXT_LEAD_MS, CONTEXT_MAX_SCANS, CONTEXT_TAIL_MS, contextWindow } from '../../src/server/services/anomaly.js';
import type { IssueResult } from '../../src/server/services/issuance.js';
import { adminClient, createHarness, errorOf, issue, safeJson, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

const MIN = 60_000;
const DAY = 86_400_000;
const hex = (s: string) => createHash('sha256').update(s).digest('hex');

describe('actionable anomalies', () => {
  let h: Harness;
  let auditor: Client;
  let operator: Client;
  let catalog: Catalog;

  beforeAll(async () => {
    h = await createHarness();
    auditor = await adminClient(h, 'AUDITOR');
    operator = await adminClient(h, 'OPERATOR');
    catalog = await seedCatalog(h.ctx);
  });
  afterAll(() => h?.close());

  const get = async (url: string, status = 200): Promise<any> => {
    const res = await auditor.get(url);
    expect(res.statusCode, `${url} → ${res.body.slice(0, 200)}`).toBe(status);
    return safeJson(res);
  };

  async function record(p: IssueResult, type: string, severity: AnomalySeverity, riskScore: number, at: Date): Promise<void> {
    await h.ctx.services.anomaly.recordFinding({ type, severity, weight: riskScore, riskScore, productId: p.product.id, codeId: p.code.id, at, details: { test: true } });
  }

  async function insertScan(p: IssueResult | null, at: Date, extra: { country?: string; device?: string; eventType?: 'VERIFY' | 'ADMIN_TEST'; packed?: number } = {}): Promise<string> {
    const row = await h.ctx.db
      .insertInto('scan_events')
      .values({
        occurred_at: at,
        code_id: p?.code.id ?? null,
        product_id: p?.product.id ?? null,
        packed_identity: p?.product.packedIdentity ?? extra.packed ?? null,
        event_type: extra.eventType ?? 'VERIFY',
        device_hash: extra.device ?? null,
        country: extra.country ?? null,
        result_state: 'AUTHENTIC',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  describe('GET /api/admin/anomalies: type, product and order', () => {
    let a: IssueResult;
    let b: IssueResult;
    let c: IssueResult;
    const t0 = Date.parse('2026-09-20T10:00:00.000Z');

    beforeAll(async () => {
      [a, b, c] = [await issue(h.ctx, catalog), await issue(h.ctx, catalog), await issue(h.ctx, catalog)];
      await record(a, 'SCAN_VELOCITY', 'MEDIUM', 45, new Date(t0));
      await record(a, 'IMPOSSIBLE_TRAVEL', 'HIGH', 40, new Date(t0 + MIN));
      await record(b, 'GEO_DISPERSION', 'HIGH', 45, new Date(t0 + 2 * MIN));
      await record(b, 'CODE_MISMATCH', 'CRITICAL', 100, new Date(t0 - 60 * MIN));
      await record(c, 'DEVICE_DIVERSITY', 'MEDIUM', 30, new Date(t0 + 3 * MIN));
      await record(c, 'POST_REVOCATION_SCAN', 'LOW', 10, new Date(t0 + 4 * MIN));
    });

    const keys = (page: any) => page.items.map((x: any) => `${x.productId === a.product.productId ? 'a' : x.productId === b.product.productId ? 'b' : 'c'}:${x.type}`);

    it('lists the most severe first (CRITICAL, HIGH, MEDIUM, LOW), the highest risk first within a severity', async () => {
      const expected = ['b:CODE_MISMATCH', 'b:GEO_DISPERSION', 'a:IMPOSSIBLE_TRAVEL', 'a:SCAN_VELOCITY', 'c:DEVICE_DIVERSITY', 'c:POST_REVOCATION_SCAN'];
      expect(keys(await get('/api/admin/anomalies'))).toEqual(expected);
      expect(keys(await get('/api/admin/anomalies?sort=severity'))).toEqual(expected);
      // Pages follow the same order without overlap.
      const p1 = await get('/api/admin/anomalies?pageSize=4');
      const p2 = await get('/api/admin/anomalies?pageSize=4&page=2');
      expect([...keys(p1), ...keys(p2)]).toEqual(expected);
    });

    it('orders by risk (then severity) or by the last time seen', async () => {
      expect(keys(await get('/api/admin/anomalies?sort=risk'))).toEqual([
        'b:CODE_MISMATCH',
        'b:GEO_DISPERSION', // 45 HIGH before 45 MEDIUM
        'a:SCAN_VELOCITY',
        'a:IMPOSSIBLE_TRAVEL',
        'c:DEVICE_DIVERSITY',
        'c:POST_REVOCATION_SCAN',
      ]);
      expect(keys(await get('/api/admin/anomalies?sort=lastSeen'))).toEqual([
        'c:POST_REVOCATION_SCAN',
        'c:DEVICE_DIVERSITY',
        'b:GEO_DISPERSION',
        'a:IMPOSSIBLE_TRAVEL',
        'a:SCAN_VELOCITY',
        'b:CODE_MISMATCH',
      ]);
    });

    it('filters by type and by product (canonical id or uuid), alone or with the other filters', async () => {
      expect(keys(await get('/api/admin/anomalies?type=IMPOSSIBLE_TRAVEL'))).toEqual(['a:IMPOSSIBLE_TRAVEL']);
      expect(keys(await get(`/api/admin/anomalies?productId=${b.product.productId}`))).toEqual(['b:CODE_MISMATCH', 'b:GEO_DISPERSION']);
      expect(keys(await get(`/api/admin/anomalies?productId=${b.product.productId.toLowerCase()}`))).toEqual(['b:CODE_MISMATCH', 'b:GEO_DISPERSION']);
      expect(keys(await get(`/api/admin/anomalies?productId=${b.product.id}`))).toEqual(['b:CODE_MISMATCH', 'b:GEO_DISPERSION']);
      expect(keys(await get(`/api/admin/anomalies?productId=${a.product.productId}&type=SCAN_VELOCITY&severity=MEDIUM&status=OPEN`))).toEqual(['a:SCAN_VELOCITY']);
      expect(keys(await get(`/api/admin/anomalies?productId=${a.product.productId}&type=GEO_DISPERSION`))).toEqual([]);
      expect(await get('/api/admin/anomalies?productId=O26-J-99999')).toMatchObject({ items: [], total: 0 });
      // Empty filter fields (a filter form) mean "any".
      expect((await get('/api/admin/anomalies?type=&productId=&sort=&status=&severity=')).total).toBe(6);
    });

    it('accepts every type the service can record, and only those', async () => {
      expect([...ANOMALY_TYPES]).toEqual(Object.keys(ANOMALY_WEIGHTS));
      for (const type of ANOMALY_TYPES) await get(`/api/admin/anomalies?type=${type}`);
      for (const url of [
        '/api/admin/anomalies?type=NOT_A_TYPE',
        '/api/admin/anomalies?type=impossible_travel',
        '/api/admin/anomalies?sort=newest',
        '/api/admin/anomalies?productId=not-a-product',
      ]) {
        expect(errorOf(await auditor.get(url)).code, url).toBe('VALIDATION_FAILED');
      }
    });

    it('summarises what waits for triage: OPEN findings by severity, the HIGH + CRITICAL badge and the known types', async () => {
      expect(await get('/api/admin/anomalies/summary')).toEqual({
        open: { LOW: 1, MEDIUM: 2, HIGH: 2, CRITICAL: 1 },
        attention: 3,
        types: Object.keys(ANOMALY_WEIGHTS),
      });
      // An acknowledged finding has been seen: it leaves the badge.
      const travel = (await get('/api/admin/anomalies?type=IMPOSSIBLE_TRAVEL')).items[0];
      expect((await operator.patch(`/api/admin/anomalies/${travel.id}`, { status: 'ACKNOWLEDGED' })).statusCode).toBe(200);
      expect(await get('/api/admin/anomalies/summary')).toMatchObject({ open: { HIGH: 1, CRITICAL: 1 }, attention: 2 });
      expect((await operator.patch(`/api/admin/anomalies/${travel.id}`, { status: 'OPEN' })).statusCode).toBe(200);
      expect((await get('/api/admin/anomalies/summary')).attention).toBe(3);
    });
  });

  describe('GET /api/admin/scans: the window from–to', () => {
    let p: IssueResult;
    const ids: string[] = [];

    beforeAll(async () => {
      p = await issue(h.ctx, catalog);
      for (const at of ['2026-09-30T23:59:59.999Z', '2026-10-01T00:00:00.000Z', '2026-10-01T12:00:00.000Z', '2026-10-02T00:00:00.000Z']) {
        ids.push(await insertScan(p, new Date(at)));
      }
    });

    const window = async (query: string) => (await get(`/api/admin/scans?productId=${p.product.productId}&${query}`)).items.map((s: any) => ids.indexOf(s.id));

    it('reads the scans made between two instants, both included, newest first', async () => {
      expect(await window('from=2026-10-01T00:00:00.000Z&to=2026-10-01T12:00:00.000Z')).toEqual([2, 1]);
      expect(await window('from=2026-10-01T00:00:00.001Z&to=2026-10-01T12:00:00Z')).toEqual([2]);
      // A time zone offset names the same instant.
      expect(await window('from=2026-10-01T02:00:00%2B02:00&to=2026-10-01T13:00:00%2B01:00')).toEqual([2, 1]);
      expect(await window('from=2026-10-01T00:00:00.000Z')).toEqual([3, 2, 1]);
      expect(await window('to=2026-10-01T00:00:00.000Z')).toEqual([1, 0]);
    });

    it('reads a UTC day as its first and last millisecond', async () => {
      expect(await window('from=2026-10-01&to=2026-10-01')).toEqual([2, 1]);
      expect(await window('to=2026-09-30')).toEqual([0]);
      expect(await window('from=2026-10-02')).toEqual([3]);
      expect(await window('from=&to=')).toEqual([3, 2, 1, 0]);
    });

    it('refuses a window that ends before it starts, or a time without a zone', async () => {
      for (const q of ['from=2026-10-02&to=2026-10-01', 'from=2026-10-01T12:00:00Z&to=2026-10-01T11:59:59Z', 'from=2026-10-01T00:00', 'to=2026-02-30', 'from=yesterday']) {
        expect(errorOf(await auditor.get(`/api/admin/scans?${q}`)).code, q).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('GET /api/admin/anomalies/:id/context', () => {
    it("shows a finding's scans: timeline, countries, distinct devices, the scan that raised it, the code and what the piece allows", async () => {
      const p = await issue(h.ctx, catalog);
      const t0 = h.clock.now().getTime();
      const scan = async (country: string, device: string) =>
        h.ctx.services.verification.verify({ code: p.code.data }, { deviceHash: hex(device), ipHash: hex(`ip-${device}`), geo: { country }, userAgentFamily: 'Mobile Safari' });
      const old = await insertScan(p, new Date(t0 - 2 * DAY), { country: 'FR', device: hex('device-old') });
      const fr = await scan('FR', 'device-paris');
      h.clock.set(t0 + 30_000);
      const staff = await insertScan(p, new Date(t0 + 30_000), { country: 'FR', device: hex('device-staff'), eventType: 'ADMIN_TEST' });
      h.clock.set(t0 + MIN);
      const jp = await scan('JP', 'device-tokyo');
      expect(jp.state).toBe('SUSPICIOUS_ACTIVITY');

      const finding = (await get(`/api/admin/anomalies?productId=${p.product.productId}&type=IMPOSSIBLE_TRAVEL`)).items[0];
      expect(finding.details.scanEventId).toBe(jp.scanId);
      const c = await get(`/api/admin/anomalies/${finding.id}/context`);

      expect(c.anomaly).toMatchObject({ id: finding.id, type: 'IMPOSSIBLE_TRAVEL', productId: p.product.productId });
      const window = contextWindow({ firstSeenAt: new Date(finding.firstSeenAt), lastSeenAt: new Date(finding.lastSeenAt), details: finding.details });
      expect(c.window).toEqual({ from: window.from.toISOString(), to: window.to.toISOString() });
      expect(Date.parse(c.window.from)).toBe(Date.parse(finding.firstSeenAt) - CONTEXT_LEAD_MS);
      expect(Date.parse(c.window.to)).toBe(Date.parse(finding.lastSeenAt) + CONTEXT_TAIL_MS);

      // Oldest first; the scan two days before and the staff's ADMIN_TEST scan are not part of it.
      expect(c.scans).toMatchObject({ total: 2, truncated: false });
      expect(c.scans.items.map((s: any) => s.id)).toEqual([fr.scanId, jp.scanId]);
      expect(c.scans.items.map((s: any) => s.id)).not.toContain(old);
      expect(c.scans.items.map((s: any) => s.id)).not.toContain(staff);
      expect(c.scans.items[0]).toMatchObject({ eventType: 'VERIFY', state: 'AUTHENTIC', country: 'FR', deviceHash: hex('device-paris'), userAgentFamily: 'Mobile Safari', riskScore: 0, trigger: false });
      expect(c.scans.items[1]).toMatchObject({ state: 'SUSPICIOUS_ACTIVITY', country: 'JP', trigger: true, riskScore: expect.any(Number) });
      expect(c.trigger).toEqual(c.scans.items[1]);
      expect(c.countries).toEqual([
        { country: 'FR', scans: 1 },
        { country: 'JP', scans: 1 },
      ]);
      expect(c.devices).toBe(2);
      expect(c.code).toEqual({ id: p.code.id, issue: 1, status: 'ACTIVE' });
      expect(c.product.productId).toBe(p.product.productId);
      expect(c.product.lifecycle).toMatchObject({ status: 'ISSUED', allowed: expect.arrayContaining(['COUNTERFEIT_FLAGGED', 'STOLEN']) });
      // Pseudonyms only: the IP pseudonym stays in the database.
      expect(JSON.stringify(c)).not.toContain(hex('ip-device-tokyo'));
    });

    it('returns the latest scans of a busy window, oldest first, and counts them all', async () => {
      const p = await issue(h.ctx, catalog);
      const t0 = Date.parse('2026-09-25T08:00:00.000Z');
      const rows = Array.from({ length: CONTEXT_MAX_SCANS + 5 }, (_, i) => ({
        occurred_at: new Date(t0 + i * 1000),
        code_id: p.code.id,
        product_id: p.product.id,
        packed_identity: p.product.packedIdentity,
        event_type: 'VERIFY' as const,
        device_hash: hex(`busy-${i % 7}`),
        country: i % 2 ? 'GB' : 'FR',
        result_state: 'AUTHENTIC' as const,
      }));
      const ids = (await h.ctx.db.insertInto('scan_events').values(rows).returning('id').execute()).map((r) => r.id);
      await h.ctx.services.anomaly.recordFinding({
        type: 'SCAN_VELOCITY',
        severity: 'MEDIUM',
        weight: 45,
        riskScore: 45,
        productId: p.product.id,
        codeId: p.code.id,
        at: new Date(t0 + (CONTEXT_MAX_SCANS + 4) * 1000),
        details: { scans: CONTEXT_MAX_SCANS + 5, windowMin: 60, scanEventId: ids[ids.length - 1] },
      });
      const finding = (await get(`/api/admin/anomalies?productId=${p.product.productId}`)).items[0];
      const c = await get(`/api/admin/anomalies/${finding.id}/context`);
      expect(c.scans.total).toBe(CONTEXT_MAX_SCANS + 5);
      expect(c.scans.truncated).toBe(true);
      expect(c.scans.items.map((s: any) => s.id)).toEqual(ids.slice(5));
      expect(c.scans.items.at(-1).trigger).toBe(true);
      expect(c.countries).toEqual([
        { country: 'FR', scans: 53 },
        { country: 'GB', scans: 52 },
      ]);
      expect(c.devices).toBe(7);
    });

    it('reads the scans of the scanned identity when the finding has no product', async () => {
      const signer = await h.ctx.keys.activeSigner();
      const category = (await h.ctx.categories.getByCode('J'))!;
      const payload = encodePayload({
        codeVersion: 1,
        genomeVersion: 1,
        keyId: signer.keyId,
        identity: { year: 2026, categoryIndex: category.index, serial: 990_042 },
        issue: 1,
        issuedDay: issuedDayFromDate(h.clock.now()),
        nonce: new Uint8Array([4, 2, 4, 2]),
      });
      const code = toBase64Url(frameCodeData(payload, await signer.sign(signingMessage(payload))));
      const first = await h.ctx.services.verification.verify({ code }, { deviceHash: hex('unreg-1'), geo: { country: 'CN' } });
      h.clock.advance(MIN);
      const second = await h.ctx.services.verification.verify({ code }, { deviceHash: hex('unreg-2'), geo: { country: 'HK' } });
      expect(second.state).toBe('UNKNOWN');

      const finding = (await get('/api/admin/anomalies?type=VALID_SIGNATURE_UNREGISTERED')).items.find((x: any) => x.occurrences === 2);
      expect(finding).toMatchObject({ productId: null, codeId: null, severity: 'CRITICAL', details: { scanEventId: second.scanId } });
      const c = await get(`/api/admin/anomalies/${finding.id}/context`);
      expect(c.product).toBeNull();
      expect(c.code).toBeNull();
      expect(c.scans.items.map((s: any) => s.id)).toEqual([first.scanId, second.scanId]);
      expect(c.trigger.id).toBe(second.scanId);
      expect(c.countries.map((x: any) => x.country)).toEqual(['CN', 'HK']);
      expect(c.devices).toBe(2);
    });

    it('answers 404 for an unknown finding and 400 for a malformed id', async () => {
      expect(errorOf(await auditor.get(`/api/admin/anomalies/${randomUUID()}/context`)).code).toBe('ANOMALY_NOT_FOUND');
      expect(errorOf(await auditor.get('/api/admin/anomalies/nope/context')).code).toBe('VALIDATION_FAILED');
    });
  });
});
