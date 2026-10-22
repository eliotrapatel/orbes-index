/**
 * The returns report over HTTP (plan MACRO M3 §2.2, R1; routes/admin/orders.ts, services/returns-report.ts): an
 * AUDITOR reads the report and its CSV (counts only, nothing personal); a LOGISTICS login and a seller are refused; a
 * malformed query answers 400, a bad period 422 PERIOD_INVALID, an unknown model 404 MODEL_NOT_FOUND. The figures are
 * held by test/services/returns-report.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ReturnsReport } from '../../src/server/services/returns-report.js';
import { ReturnsWorld } from '../support/returns.js';
import { adminClient, createAdmin, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

describe('the returns report\'s routes (plan MACRO M3 §2.2, R1)', () => {
  let h: Harness;
  let auditor: Client;
  let operator: Client;
  let agent: Client;
  let seller: Client;
  let modelId = '';
  let email = '';

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-22T09:00:00.000Z');
    auditor = await adminClient(h, 'AUDITOR');
    operator = await adminClient(h, 'OPERATOR');
    agent = await adminClient(h, 'LOGISTICS');
    seller = await adminClient(h, 'RETAIL');
    const w = await new ReturnsWorld(h.t.db, (await createAdmin(h.ctx, 'ADMIN')).id).prepare();
    modelId = await w.model('HALO');
    const opened = new Date('2026-09-01T10:00:00.000Z');
    for (const to of ['54', '56', '56']) await w.case({ modelId, size: '52', kind: 'EXCHANGE', to, opened });
    await w.case({ modelId, size: '52', kind: 'RETURN', reason: 'DAMAGED', opened });
    email = (await h.t.db.selectFrom('accounts').innerJoin('orders', 'orders.account_id', 'accounts.id').select('accounts.email').where('orders.model_id', '=', modelId).executeTakeFirstOrThrow()).email;
  });
  afterAll(() => h?.close());

  it('an AUDITOR reads the report and its CSV, counts only; LOGISTICS and RETAIL are refused', async () => {
    const res = await auditor.get(`/api/admin/orders/returns?modelId=${modelId}`);
    expect(res.statusCode, res.body).toBe(200);
    const r = safeJson(res) as ReturnsReport;
    expect(r.period).toEqual({ from: '2025-10-23', to: '2026-10-22' });
    expect(r.summary).toEqual({ requests: 4, returns: 1, exchanges: 3 });
    expect(r.byModel).toHaveLength(1);
    expect(r.byModel[0]).toMatchObject({ model: { id: modelId, name: 'HALO', variant: null }, toLarger: 3, flag: 'RUNS_SMALL', reasons: { SIZE: 3, DAMAGED: 1 } });
    // Nothing personal: no email, no account.
    expect(res.body).not.toContain(email);
    expect(res.body).not.toContain('accountId');

    const csv = await auditor.get(`/api/admin/orders/returns.csv?modelId=${modelId}&from=2026-09-01&to=2026-09-30`);
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.headers['content-type']).toMatch(/^text\/csv/);
    expect(csv.headers['cache-control']).toBe('no-store');
    expect(csv.headers['content-disposition']).toBe('attachment; filename="orbes-returns-2026-09-01-to-2026-09-30.csv"');
    expect(csv.body.split('\r\n')[1]).toBe('"By model","HALO","","","4","1","3","3","0","1","0","0","3","0","RUNS SMALL"');
    expect(csv.body).not.toContain(email);

    expect((await operator.get('/api/admin/orders/returns?all=true&test=true')).statusCode).toBe(200);
    for (const c of [agent, seller]) {
      expect(errorOf(await c.get('/api/admin/orders/returns')).code).toBe('FORBIDDEN');
      expect(errorOf(await c.get('/api/admin/orders/returns.csv')).code).toBe('FORBIDDEN');
    }
  });

  it('answers a malformed query 400, a bad period 422 PERIOD_INVALID and an unknown model 404 MODEL_NOT_FOUND', async () => {
    expect(errorOf(await auditor.get('/api/admin/orders/returns?from=2026-13-01&to=2026-12-01')).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await auditor.get('/api/admin/orders/returns?test=maybe')).code).toBe('VALIDATION_FAILED');
    const half = await auditor.get('/api/admin/orders/returns?from=2026-01-01');
    expect(half.statusCode).toBe(422);
    expect(errorOf(half)).toEqual({ code: 'PERIOD_INVALID', message: 'Give the first and the last day, or neither.' });
    expect(errorOf(await auditor.get('/api/admin/orders/returns?from=2026-02-01&to=2026-01-01')).code).toBe('PERIOD_INVALID');
    expect(errorOf(await auditor.get('/api/admin/orders/returns.csv?all=true&from=2026-01-01&to=2026-01-02')).code).toBe('PERIOD_INVALID');
    const unknown = await auditor.get('/api/admin/orders/returns?modelId=00000000-0000-4000-8000-000000000000');
    expect(unknown.statusCode).toBe(404);
    expect(errorOf(unknown).code).toBe('MODEL_NOT_FOUND');
  });
});
