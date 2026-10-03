/**
 * Role enforcement for every admin route group: AUDITOR reads, OPERATOR
 * mutates (the catalogue's models and collections included, created or
 * edited, their lookbook and its gallery, P-R02, and the photographs of models and pieces, F-04,
 * and the drops of the Club page, P-R03: created, edited, published, cancelled, their entries
 * concluded and the next one offered), ADMIN for keys, revocations, reinstatement, categories (created,
 * activated or deactivated), the console users of the Team page (A-02), the
 * points of sale (A-08), a customer's recovery code, lock and export, and the draw of a drop;
 * every role changes its own password. RETAIL (A-08) ranks under AUDITOR: it
 * reaches the sale mode, the list of points of sale and its own session,
 * password and second factor, nothing else. The sale mode names its roles
 * (RETAIL, OPERATOR, ADMIN): it starts warranties, so the read-only AUDITOR,
 * though above RETAIL, does not sell.
 *
 * "Allowed" is probed with a request the guard lets through but validation
 * then rejects (400) or that targets nothing (404), so the probes have no
 * side effects; "forbidden" must be 403 FORBIDDEN before any validation.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminRole } from '../../src/server/db/schema.js';
import { jpegPhoto } from '../support/images.js';
import { adminClient, createHarness, errorOf, type Client, type Harness } from './support.js';

/**
 * `min`: the rank the route needs; `roles`, when given, the exact roles it lets in instead (the sale mode). `headers`:
 * a body that is not JSON (the photographs of F-04 take the image itself).
 */
type Probe = { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; body?: unknown; headers?: Record<string, string>; min: AdminRole; roles?: readonly AdminRole[]; group: string };
const SELLERS: readonly AdminRole[] = ['RETAIL', 'OPERATOR', 'ADMIN'];
const allows = (p: Probe, role: AdminRole) => (p.roles ? p.roles.includes(role) : RANK[role] >= RANK[p.min]);

const RANK: Record<AdminRole, number> = { RETAIL: 1, AUDITOR: 2, OPERATOR: 3, ADMIN: 4 };
const PID = 'O26-J-00001';
const UUID = randomUUID();
const INVALID = { definitelyNotAField: true };
/** A real photograph: the image routes check the type before the target, so an allowed probe ends in 404. */
const PHOTO = { body: Buffer.from(jpegPhoto(8, 8)), headers: { 'content-type': 'image/jpeg' } };

const PROBES: Probe[] = [
  { group: 'dashboard', method: 'GET', url: '/api/admin/dashboard', min: 'AUDITOR' },
  { group: 'analytics', method: 'GET', url: '/api/admin/analytics', min: 'AUDITOR' },
  { group: 'documents', method: 'GET', url: '/api/admin/documents', min: 'AUDITOR' },
  { group: 'documents', method: 'GET', url: '/api/admin/documents/sales-playbook', min: 'AUDITOR' },
  { group: 'documents', method: 'GET', url: '/api/admin/documents/assets/certificate-card-specimen.svg', min: 'AUDITOR' },
  { group: 'analytics', method: 'GET', url: '/api/admin/analytics?from=2025-10-01&to=2026-10-01', min: 'AUDITOR' },
  { group: 'analytics', method: 'GET', url: '/api/admin/analytics?days=367', min: 'AUDITOR' },
  { group: 'categories', method: 'GET', url: '/api/admin/categories', min: 'AUDITOR' },
  { group: 'categories', method: 'POST', url: '/api/admin/categories', body: INVALID, min: 'ADMIN' },
  { group: 'categories', method: 'POST', url: '/api/admin/categories/J/active', body: INVALID, min: 'ADMIN' },
  { group: 'models', method: 'GET', url: '/api/admin/models', min: 'AUDITOR' },
  { group: 'models', method: 'POST', url: '/api/admin/models', body: INVALID, min: 'OPERATOR' },
  { group: 'models', method: 'PATCH', url: `/api/admin/models/${UUID}`, body: INVALID, min: 'OPERATOR' },
  { group: 'models', method: 'GET', url: `/api/admin/models/${UUID}`, min: 'AUDITOR' },
  { group: 'lookbook', method: 'POST', url: `/api/admin/models/${UUID}/gallery`, ...PHOTO, min: 'OPERATOR' },
  { group: 'lookbook', method: 'DELETE', url: `/api/admin/models/${UUID}/gallery/${'ab'.repeat(32)}`, min: 'OPERATOR' },
  { group: 'lookbook', method: 'PATCH', url: `/api/admin/models/${UUID}/gallery`, body: INVALID, min: 'OPERATOR' },
  { group: 'media', method: 'POST', url: `/api/admin/models/${UUID}/image`, ...PHOTO, min: 'OPERATOR' },
  { group: 'media', method: 'DELETE', url: `/api/admin/models/${UUID}/image`, min: 'OPERATOR' },
  { group: 'media', method: 'POST', url: `/api/admin/products/${PID}/photo`, ...PHOTO, min: 'OPERATOR' },
  { group: 'media', method: 'DELETE', url: `/api/admin/products/${PID}/photo`, min: 'OPERATOR' },
  { group: 'collections', method: 'GET', url: '/api/admin/collections', min: 'AUDITOR' },
  { group: 'collections', method: 'POST', url: '/api/admin/collections', body: INVALID, min: 'OPERATOR' },
  { group: 'collections', method: 'PATCH', url: `/api/admin/collections/${UUID}`, body: INVALID, min: 'OPERATOR' },
  { group: 'products', method: 'GET', url: '/api/admin/products', min: 'AUDITOR' },
  { group: 'products', method: 'POST', url: '/api/admin/products', body: INVALID, min: 'OPERATOR' },
  { group: 'products', method: 'POST', url: '/api/admin/products/batch', body: INVALID, min: 'OPERATOR' },
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
  { group: 'codes', method: 'POST', url: '/api/admin/codes/print-sheet/manifest', body: INVALID, min: 'OPERATOR' },
  { group: 'certificates', method: 'POST', url: '/api/admin/certificates', body: INVALID, min: 'OPERATOR' },
  { group: 'genomes', method: 'GET', url: '/api/admin/genomes', min: 'AUDITOR' },
  { group: 'codes', method: 'GET', url: '/api/admin/codes', min: 'AUDITOR' },
  { group: 'codes', method: 'GET', url: '/api/admin/codes?productionBatch=B-2026-09-A&status=ACTIVE&issuedFrom=2026-09-01', min: 'AUDITOR' },
  { group: 'codes', method: 'GET', url: '/api/admin/codes/ids?productionBatch=B-2026-09-A', min: 'AUDITOR' },
  { group: 'products', method: 'GET', url: '/api/admin/products?productionBatch=B-2026-09-A', min: 'AUDITOR' },
  { group: 'scans', method: 'GET', url: '/api/admin/scans', min: 'AUDITOR' },
  { group: 'scans', method: 'GET', url: `/api/admin/scans?productId=${PID}&from=2026-10-01&to=2026-10-01T12:00:00Z`, min: 'AUDITOR' },
  { group: 'owners', method: 'GET', url: '/api/admin/owners', min: 'AUDITOR' },
  { group: 'owners', method: 'POST', url: `/api/admin/owners/${UUID}/recovery-code`, body: INVALID, min: 'ADMIN' },
  { group: 'owners', method: 'GET', url: '/api/admin/owners?email=client%40example.com', min: 'AUDITOR' },
  { group: 'owners', method: 'GET', url: '/api/admin/owners?ref=1A2B3C4D', min: 'AUDITOR' },
  { group: 'owners', method: 'GET', url: `/api/admin/owners/${UUID}`, min: 'AUDITOR' },
  { group: 'owners', method: 'POST', url: `/api/admin/owners/${UUID}/lock`, body: INVALID, min: 'ADMIN' },
  { group: 'owners', method: 'POST', url: `/api/admin/owners/${UUID}/unlock`, body: INVALID, min: 'ADMIN' },
  { group: 'owners', method: 'GET', url: `/api/admin/owners/${UUID}/export`, min: 'ADMIN' },
  { group: 'drops', method: 'GET', url: '/api/admin/drops', min: 'AUDITOR' },
  { group: 'drops', method: 'POST', url: '/api/admin/drops', body: INVALID, min: 'OPERATOR' },
  { group: 'drops', method: 'GET', url: `/api/admin/drops/${UUID}`, min: 'AUDITOR' },
  { group: 'drops', method: 'PATCH', url: `/api/admin/drops/${UUID}`, body: INVALID, min: 'OPERATOR' },
  { group: 'drops', method: 'POST', url: `/api/admin/drops/${UUID}/publish`, body: INVALID, min: 'OPERATOR' },
  { group: 'drops', method: 'POST', url: `/api/admin/drops/${UUID}/cancel`, body: INVALID, min: 'OPERATOR' },
  { group: 'drops', method: 'POST', url: `/api/admin/drops/${UUID}/draw`, body: INVALID, min: 'ADMIN' },
  { group: 'drops', method: 'GET', url: `/api/admin/drops/${UUID}/entries`, min: 'AUDITOR' },
  { group: 'drops', method: 'GET', url: `/api/admin/drops/${UUID}/entries?status=SELECTED`, min: 'AUDITOR' },
  { group: 'drops', method: 'POST', url: `/api/admin/drops/${UUID}/entries/${UUID}/confirm`, body: INVALID, min: 'OPERATOR' },
  { group: 'drops', method: 'POST', url: `/api/admin/drops/${UUID}/entries/${UUID}/lapse`, body: INVALID, min: 'OPERATOR' },
  { group: 'drops', method: 'POST', url: `/api/admin/drops/${UUID}/offer-next`, body: INVALID, min: 'OPERATOR' },
  { group: 'warranties', method: 'GET', url: '/api/admin/warranties', min: 'AUDITOR' },
  { group: 'anomalies', method: 'GET', url: '/api/admin/anomalies', min: 'AUDITOR' },
  { group: 'anomalies', method: 'GET', url: `/api/admin/anomalies?type=IMPOSSIBLE_TRAVEL&productId=${PID}&sort=risk`, min: 'AUDITOR' },
  { group: 'anomalies', method: 'GET', url: '/api/admin/anomalies/summary', min: 'AUDITOR' },
  { group: 'anomalies', method: 'GET', url: `/api/admin/anomalies/${UUID}/context`, min: 'AUDITOR' },
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
  { group: 'admins', method: 'POST', url: '/api/admin/admins', body: INVALID, min: 'ADMIN' },
  { group: 'admins', method: 'PATCH', url: `/api/admin/admins/${UUID}/role`, body: INVALID, min: 'ADMIN' },
  { group: 'admins', method: 'POST', url: `/api/admin/admins/${UUID}/disable`, body: INVALID, min: 'ADMIN' },
  { group: 'admins', method: 'POST', url: `/api/admin/admins/${UUID}/enable`, body: INVALID, min: 'ADMIN' },
  { group: 'admins', method: 'POST', url: `/api/admin/admins/${UUID}/unlock`, body: INVALID, min: 'ADMIN' },
  { group: 'admins', method: 'GET', url: `/api/admin/admins/${UUID}/sessions`, min: 'ADMIN' },
  { group: 'admins', method: 'DELETE', url: `/api/admin/admins/${UUID}/sessions`, min: 'ADMIN' },
  { group: 'auth', method: 'GET', url: '/api/admin/auth/me', min: 'RETAIL' },
  { group: 'auth', method: 'POST', url: '/api/admin/auth/totp/enable', body: INVALID, min: 'RETAIL' },
  { group: 'password', method: 'POST', url: '/api/admin/auth/password', body: INVALID, min: 'RETAIL' },
  { group: 'retailers', method: 'GET', url: '/api/admin/retailers', min: 'RETAIL' },
  { group: 'retailers', method: 'GET', url: '/api/admin/retailers?active=true', min: 'RETAIL' },
  { group: 'retailers', method: 'POST', url: '/api/admin/retailers', body: INVALID, min: 'ADMIN' },
  { group: 'retailers', method: 'PATCH', url: `/api/admin/retailers/${UUID}`, body: INVALID, min: 'ADMIN' },
  { group: 'sale', method: 'POST', url: '/api/admin/sale/lookup', body: INVALID, min: 'RETAIL', roles: SELLERS },
  { group: 'sale', method: 'POST', url: '/api/admin/sale/activate', body: INVALID, min: 'RETAIL', roles: SELLERS },
  { group: 'audit', method: 'GET', url: '/api/admin/audit', min: 'AUDITOR' },
  { group: 'audit', method: 'GET', url: '/api/admin/audit/verify', min: 'AUDITOR' },
];

describe('admin role enforcement', () => {
  let h: Harness;
  const clients = {} as Record<AdminRole, Client>;

  beforeAll(async () => {
    h = await createHarness();
    for (const role of ['RETAIL', 'AUDITOR', 'OPERATOR', 'ADMIN'] as const) clients[role] = await adminClient(h, role);
  });
  afterAll(() => h?.close());

  it('covers every admin route of the contract', () => {
    const groups = new Set(PROBES.map((p) => p.group));
    for (const g of [
      'dashboard',
      'analytics',
      'documents',
      'categories',
      'models',
      'collections',
      'products',
      'lifecycle',
      'codes',
      'certificates',
      'warranty',
      'services',
      'ownership',
      'genomes',
      'scans',
      'owners',
      'warranties',
      'anomalies',
      'reports',
      'revocations',
      'keys',
      'audit',
      'admins',
      'auth',
      'password',
      'retailers',
      'sale',
      'media',
      'lookbook',
      'drops',
    ]) {
      expect(groups.has(g)).toBe(true);
    }
  });

  for (const role of ['RETAIL', 'AUDITOR', 'OPERATOR', 'ADMIN'] as const) {
    it(`${role}: allowed exactly where its rank reaches (or where the route names it)`, async () => {
      for (const p of PROBES) {
        const res = await clients[role].request(p.method, p.url, { ...(p.body !== undefined ? { body: p.body } : {}), ...(p.headers ? { headers: p.headers } : {}) });
        const label = `${role} ${p.method} ${p.url} → ${res.statusCode} ${res.body.slice(0, 120)}`;
        if (allows(p, role)) {
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
      const res = await anon.request(p.method, p.url, { ...(p.body !== undefined ? { body: p.body } : {}), ...(p.headers ? { headers: p.headers } : {}) });
      expect(res.statusCode, `${p.method} ${p.url}`).toBe(401);
    }
  });

  it('a customer session is not an admin session', async () => {
    const c = h.client();
    await c.post('/api/v1/account/register', { email: `cust-${randomUUID().slice(0, 6)}@example.com`, password: 'correct horse battery staple' });
    expect((await c.get('/api/admin/dashboard')).statusCode).toBe(401);
  });

  it('OPERATOR, AUDITOR and RETAIL get 403 on every Team route (A-02), before validation', async () => {
    const team = PROBES.filter((p) => p.url.startsWith('/api/admin/admins'));
    expect(team).toHaveLength(9);
    for (const role of ['OPERATOR', 'AUDITOR', 'RETAIL'] as const) {
      for (const p of team) {
        const res = await clients[role].request(p.method, p.url, p.body !== undefined ? { body: p.body } : {});
        expect(res.statusCode, `${role} ${p.method} ${p.url}`).toBe(403);
        expect(errorOf(res).code).toBe('FORBIDDEN');
      }
    }
  });

  it('RETAIL (A-08) can neither issue, nor download, nor read owners or scans: only the sale mode, the points of sale and its own account', async () => {
    const retail = clients.RETAIL;
    const refused: [string, string, unknown?][] = [
      ['POST', '/api/admin/products', { categoryCode: 'J', modelId: UUID, material: 'SILVER' }],
      ['GET', `/api/admin/codes/${UUID}/artifact.svg`],
      ['GET', `/api/admin/codes/${UUID}/artifact.pdf`],
      ['POST', '/api/admin/codes/print-sheet', { codeIds: [UUID] }],
      ['POST', '/api/admin/certificates', { items: [{ productId: PID, claimCode: 'X' }] }],
      ['GET', '/api/admin/owners'],
      ['GET', '/api/admin/scans'],
      ['GET', '/api/admin/products'],
      ['GET', `/api/admin/products/${PID}`],
      ['POST', `/api/admin/products/${PID}/warranty/activate`, {}],
      ['GET', '/api/admin/dashboard'],
      ['GET', '/api/admin/warranties'],
      ['GET', '/api/admin/audit'],
    ];
    for (const [method, url, body] of refused) {
      const res = await retail.request(method, url, body !== undefined ? { body } : {});
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(errorOf(res).code, `${method} ${url}`).toBe('FORBIDDEN');
    }
    const allowed = PROBES.filter((p) => p.min === 'RETAIL').map((p) => `${p.method} ${p.url.split('?')[0]}`);
    expect([...new Set(allowed)].sort()).toEqual(
      [
        'GET /api/admin/auth/me',
        'GET /api/admin/retailers',
        'POST /api/admin/auth/password',
        'POST /api/admin/auth/totp/enable',
        'POST /api/admin/sale/activate',
        'POST /api/admin/sale/lookup',
      ].sort(),
    );
    // Its own session: me, a TOTP enrolment started, sign-out.
    expect((await retail.get('/api/admin/auth/me')).statusCode).toBe(200);
    expect((await retail.post('/api/admin/auth/totp/setup')).statusCode).toBe(200);
    expect((await retail.post('/api/admin/auth/logout')).statusCode).toBe(200);
    expect((await retail.get('/api/admin/auth/me')).statusCode).toBe(401);
    clients.RETAIL = await adminClient(h, 'RETAIL');
  });

  it('AUDITOR (A-08) reads the points of sale but never sells: the sale mode starts warranties, a mutation', async () => {
    for (const url of ['/api/admin/sale/lookup', '/api/admin/sale/activate']) {
      const res = await clients.AUDITOR.post(url, INVALID);
      expect(res.statusCode, url).toBe(403);
      expect(errorOf(res).code, url).toBe('FORBIDDEN');
      // RETAIL, OPERATOR and ADMIN pass the guard (then validation refuses the body).
      for (const role of SELLERS) expect((await clients[role].post(url, INVALID)).statusCode, `${role} ${url}`).toBe(400);
    }
    expect((await clients.AUDITOR.get('/api/admin/retailers')).statusCode).toBe(200);
  });

  it('OPERATOR may transition products but not revoke them', async () => {
    const res = await clients.OPERATOR.post(`/api/admin/products/${PID}/transitions`, { to: 'REVOKED', reason: 'x' });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('FORBIDDEN');
    // ADMIN gets past the role check (the product does not exist here).
    expect((await clients.ADMIN.post(`/api/admin/products/${PID}/transitions`, { to: 'REVOKED', reason: 'x' })).statusCode).toBe(404);
  });
});
