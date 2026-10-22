/**
 * The standard boxes over HTTP (macro scope of 2026-10-20, D16 B1; plan MACRO M3 §1.2, step M3.2; routes/admin/boxes.ts):
 * an AUDITOR reads the list, an ADMIN adds, changes, sets aside and reinstates a box, as the other settings of the
 * orders; an OPERATOR and a LOGISTICS login are refused; the card rule and the cost with its currency answer as the
 * service says (test/services/boxes.test.ts holds the service).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

const CUBE = { name: 'CUBE 100', insideLengthMm: 100, insideWidthMm: 70, insideHeightMm: 40, emptyWeightG: 120 };

describe('the boxes\' routes (plan MACRO M3 §1.2, B1)', () => {
  let h: Harness;
  let adminHttp: Client;
  let operator: Client;
  let auditor: Client;
  let agent: Client;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-22T09:00:00.000Z');
    adminHttp = await adminClient(h, 'ADMIN');
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    agent = await adminClient(h, 'LOGISTICS');
  });
  afterAll(() => h?.close());

  it('an AUDITOR reads, an ADMIN writes, an OPERATOR and a LOGISTICS login are refused', async () => {
    const created = await adminHttp.post('/api/admin/boxes', { name: 'ROUTE BOX', insideLengthMm: 120, insideWidthMm: 90, insideHeightMm: 50, emptyWeightG: 150, costMinor: 95, currency: 'EUR' });
    expect(created.statusCode, created.body).toBe(201);
    const b = safeJson(created) as { id: string; name: string; costMinor: number };
    expect(b).toMatchObject({ name: 'ROUTE BOX', costMinor: 95 });
    expect(errorOf(await adminHttp.post('/api/admin/boxes', { name: 'TINY', insideLengthMm: 60, insideWidthMm: 60, insideHeightMm: 50, emptyWeightG: 150 }))).toEqual({
      code: 'BOX_TOO_SMALL_FOR_CARD',
      message: 'This box cannot take the 95 × 62 mm certificate card flat.',
    });
    expect(errorOf(await adminHttp.post('/api/admin/boxes', { name: 'NO CURRENCY', insideLengthMm: 120, insideWidthMm: 90, insideHeightMm: 50, emptyWeightG: 150, costMinor: 95 })).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await adminHttp.post('/api/admin/boxes', { ...CUBE, name: 'EXTRA', active: false })).code).toBe('VALIDATION_FAILED');
    const patched = await adminHttp.patch(`/api/admin/boxes/${b.id}`, { emptyWeightG: 160 });
    expect(patched.statusCode, patched.body).toBe(200);
    expect((safeJson(patched) as { emptyWeightG: number }).emptyWeightG).toBe(160);
    expect(errorOf(await adminHttp.patch(`/api/admin/boxes/${b.id}`, {})).code).toBe('VALIDATION_FAILED');
    expect((await adminHttp.post(`/api/admin/boxes/${b.id}/set-aside`)).statusCode).toBe(200);
    expect((await adminHttp.post(`/api/admin/boxes/${b.id}/reinstate`, {})).statusCode).toBe(200);
    const read = await auditor.get('/api/admin/boxes');
    expect(read.statusCode).toBe(200);
    expect((safeJson(read) as { items: { name: string; costMinor: number | null }[] }).items.find((x) => x.name === 'ROUTE BOX')).toMatchObject({ costMinor: 95 });
    for (const c of [operator, auditor]) expect(errorOf(await c.post('/api/admin/boxes', { ...CUBE, name: 'REFUSED' })).code).toBe('FORBIDDEN');
    expect(errorOf(await operator.post(`/api/admin/boxes/${b.id}/set-aside`)).code).toBe('FORBIDDEN');
    expect(errorOf(await agent.get('/api/admin/boxes')).code).toBe('FORBIDDEN');
  });
});
