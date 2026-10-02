/**
 * Role enforcement for every admin route group: AUDITOR reads, OPERATOR
 * mutates, ADMIN for keys, revocations, reinstatement and categories.
 *
 * "Allowed" is probed with a request the guard lets through but validation
 * then rejects (400) or that targets nothing (404), so the probes have no
 * side effects; "forbidden" must be 403 FORBIDDEN before any validation.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminRole } from '../../src/server/db/schema.js';
import { adminClient, createHarness, errorOf, type Client, type Harness } from './support.js';

type Probe = { method: 'GET' | 'POST' | 'PATCH'; url: string; body?: unknown; min: AdminRole; group: string };

const RANK: Record<AdminRole, number> = { AUDITOR: 1, OPERATOR: 2, ADMIN: 3 };
const PID = 'O26-J-00001';
const UUID = randomUUID();
const INVALID = { definitelyNotAField: true };

const PROBES: Probe[] = [
  { group: 'dashboard', method: 'GET', url: '/api/admin/dashboard', min: 'AUDITOR' },
  { group: 'categories', method: 'GET', url: '/api/admin/categories', min: 'AUDITOR' },
  { group: 'categories', method: 'POST', url: '/api/admin/categories', body: INVALID, min: 'ADMIN' },
  { group: 'models', method: 'GET', url: '/api/admin/models', min: 'AUDITOR' },
  { group: 'models', method: 'POST', url: '/api/admin/models', body: INVALID, min: 'OPERATOR' },
  { group: 'collections', method: 'GET', url: '/api/admin/collections', min: 'AUDITOR' },
  { group: 'collections', method: 'POST', url: '/api/admin/collections', body: INVALID, min: 'OPERATOR' },
  { group: 'products', method: 'GET', url: '/api/admin/products', min: 'AUDITOR' },
  { group: 'products', method: 'POST', url: '/api/admin/products', body: INVALID, min: 'OPERATOR' },
  { group: 'products', method: 'GET', url: `/api/admin/products/${PID}`, min: 'AUDITOR' },
  { group: 'lifecycle', method: 'POST', url: `/api/admin/products/${PID}/transitions`, body: INVALID, min: 'OPERATOR' },
  { group: 'lifecycle', method: 'POST', url: `/api/admin/products/${PID}/reinstate`, body: INVALID, min: 'ADMIN' },
  { group: 'codes', method: 'POST', url: `/api/admin/products/${PID}/codes/reissue`, body: INVALID, min: 'OPERATOR' },
  { group: 'warranty', method: 'POST', url: `/api/admin/products/${PID}/warranty/activate`, body: INVALID, min: 'OPERATOR' },
  { group: 'warranty', method: 'POST', url: `/api/admin/products/${PID}/warranty/void`, body: INVALID, min: 'OPERATOR' },
  { group: 'warranty', method: 'POST', url: `/api/admin/products/${PID}/warranty/extend`, body: INVALID, min: 'OPERATOR' },
  { group: 'services', method: 'POST', url: `/api/admin/products/${PID}/services`, body: INVALID, min: 'OPERATOR' },
  { group: 'services', method: 'POST', url: `/api/admin/services/${UUID}/complete`, body: INVALID, min: 'OPERATOR' },
  { group: 'ownership', method: 'POST', url: `/api/admin/products/${PID}/ownership/confirm`, body: INVALID, min: 'OPERATOR' },
  { group: 'codes', method: 'GET', url: `/api/admin/codes/${UUID}/artifact.svg`, min: 'OPERATOR' },
  { group: 'codes', method: 'POST', url: `/api/admin/codes/${UUID}/revoke`, body: INVALID, min: 'ADMIN' },
  { group: 'codes', method: 'POST', url: '/api/admin/codes/print-sheet', body: INVALID, min: 'OPERATOR' },
  { group: 'certificates', method: 'POST', url: '/api/admin/certificates', body: INVALID, min: 'OPERATOR' },
  { group: 'genomes', method: 'GET', url: '/api/admin/genomes', min: 'AUDITOR' },
  { group: 'codes', method: 'GET', url: '/api/admin/codes', min: 'AUDITOR' },
  { group: 'scans', method: 'GET', url: '/api/admin/scans', min: 'AUDITOR' },
  { group: 'owners', method: 'GET', url: '/api/admin/owners', min: 'AUDITOR' },
  { group: 'warranties', method: 'GET', url: '/api/admin/warranties', min: 'AUDITOR' },
  { group: 'anomalies', method: 'GET', url: '/api/admin/anomalies', min: 'AUDITOR' },
  { group: 'anomalies', method: 'PATCH', url: `/api/admin/anomalies/${UUID}`, body: INVALID, min: 'OPERATOR' },
  { group: 'reports', method: 'GET', url: '/api/admin/reports', min: 'AUDITOR' },
  { group: 'reports', method: 'PATCH', url: `/api/admin/reports/${UUID}`, body: INVALID, min: 'OPERATOR' },
  { group: 'revocations', method: 'GET', url: '/api/admin/revocations', min: 'AUDITOR' },
  { group: 'revocations', method: 'POST', url: '/api/admin/revocations', body: INVALID, min: 'ADMIN' },
  { group: 'keys', method: 'GET', url: '/api/admin/keys', min: 'AUDITOR' },
  { group: 'keys', method: 'POST', url: '/api/admin/keys/rotate', body: INVALID, min: 'ADMIN' },
  { group: 'keys', method: 'POST', url: '/api/admin/keys/1/retire', body: INVALID, min: 'ADMIN' },
  { group: 'keys', method: 'POST', url: '/api/admin/keys/1/revoke', body: INVALID, min: 'ADMIN' },
  { group: 'admins', method: 'GET', url: '/api/admin/admins', min: 'ADMIN' },
  { group: 'admins', method: 'POST', url: `/api/admin/admins/${UUID}/totp/reset`, body: INVALID, min: 'ADMIN' },
  { group: 'audit', method: 'GET', url: '/api/admin/audit', min: 'AUDITOR' },
  { group: 'audit', method: 'GET', url: '/api/admin/audit/verify', min: 'AUDITOR' },
];

describe('admin role enforcement', () => {
  let h: Harness;
  const clients = {} as Record<AdminRole, Client>;

  beforeAll(async () => {
    h = await createHarness();
    for (const role of ['AUDITOR', 'OPERATOR', 'ADMIN'] as const) clients[role] = await adminClient(h, role);
  });
  afterAll(() => h?.close());

  it('covers every admin route of the contract', () => {
    const groups = new Set(PROBES.map((p) => p.group));
    for (const g of ['dashboard', 'categories', 'models', 'collections', 'products', 'lifecycle', 'codes', 'certificates', 'warranty', 'services', 'ownership', 'genomes', 'scans', 'owners', 'warranties', 'anomalies', 'reports', 'revocations', 'keys', 'audit', 'admins']) {
      expect(groups.has(g)).toBe(true);
    }
  });

  for (const role of ['AUDITOR', 'OPERATOR', 'ADMIN'] as const) {
    it(`${role}: allowed exactly where its rank reaches`, async () => {
      for (const p of PROBES) {
        const res = await clients[role].request(p.method, p.url, p.body !== undefined ? { body: p.body } : {});
        const label = `${role} ${p.method} ${p.url} → ${res.statusCode} ${res.body.slice(0, 120)}`;
        if (RANK[role] >= RANK[p.min]) {
          expect([200, 201, 400, 404], label).toContain(res.statusCode);
          if (res.statusCode === 400) expect(errorOf(res).code, label).toBe('VALIDATION_FAILED');
        } else {
          expect(res.statusCode, label).toBe(403);
          expect(errorOf(res).code, label).toBe('FORBIDDEN');
        }
      }
    });
  }

  it('anonymous callers get 401 on every admin route', async () => {
    const anon = h.client();
    for (const p of PROBES) {
      const res = await anon.request(p.method, p.url, p.body !== undefined ? { body: p.body } : {});
      expect(res.statusCode, `${p.method} ${p.url}`).toBe(401);
    }
  });

  it('a customer session is not an admin session', async () => {
    const c = h.client();
    await c.post('/api/v1/account/register', { email: `cust-${randomUUID().slice(0, 6)}@example.com`, password: 'correct horse battery staple' });
    expect((await c.get('/api/admin/dashboard')).statusCode).toBe(401);
  });

  it('OPERATOR may transition products but not revoke them', async () => {
    const res = await clients.OPERATOR.post(`/api/admin/products/${PID}/transitions`, { to: 'REVOKED', reason: 'x' });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('FORBIDDEN');
    // ADMIN gets past the role check (the product does not exist here).
    expect((await clients.ADMIN.post(`/api/admin/products/${PID}/transitions`, { to: 'REVOKED', reason: 'x' })).statusCode).toBe(404);
  });
});
