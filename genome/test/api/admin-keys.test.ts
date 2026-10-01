import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, createHarness, issue, safeJson, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

describe('admin keys, revocations and audit', () => {
  let h: Harness;
  let admin: Client;
  let auditor: Client;
  let catalog: Catalog;

  beforeAll(async () => {
    h = await createHarness();
    catalog = await seedCatalog(h.ctx);
    admin = await adminClient(h, 'ADMIN');
    auditor = await adminClient(h, 'AUDITOR');
  });
  afterAll(() => h?.close());

  it('lists keys without private material', async () => {
    const res = await auditor.get('/api/admin/keys');
    expect(res.statusCode).toBe(200);
    const { items } = safeJson(res) as { items: any[] };
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ keyId: 1, alg: 'Ed25519', status: 'ACTIVE', provider: 'memory' });
    expect(res.body).not.toMatch(/providerRef|seed|privateKey/);
  });

  it('rotates, retires and revokes keys; old codes keep verifying until revocation', async () => {
    const before = await issue(h.ctx, catalog);
    const rot = await admin.post('/api/admin/keys/rotate', { kid: 'orbes-test-k2' });
    expect(rot.statusCode, rot.body).toBe(201);
    expect(safeJson(rot)).toMatchObject({ keyId: 2, kid: 'orbes-test-k2', status: 'ACTIVE' });
    const keys = (safeJson(await auditor.get('/api/admin/keys')) as any).items;
    expect(keys.find((k: any) => k.keyId === 1).status).toBe('RETIRED');
    expect((safeJson(await h.client().post('/api/v1/verify', { code: before.code.data })) as any).state).toBe('AUTHENTIC');

    // Revoke key 1 with a compromise time before the code was recorded → the code no longer verifies.
    const compromisedAt = new Date(h.ctx.clock().getTime() - 60_000).toISOString();
    const rev = await admin.post('/api/admin/keys/1/revoke', { reason: 'HSM audit finding', compromisedAt });
    expect(rev.statusCode, rev.body).toBe(200);
    expect(safeJson(rev)).toMatchObject({ keyId: 1, status: 'REVOKED', compromisedAt });
    // Third-party verifiers get the same cut-off from the public key list.
    const published = (safeJson(await h.client().get('/.well-known/orbes-keys.json')) as any).keys.find((k: any) => k.keyId === 1);
    expect(published).toMatchObject({ status: 'REVOKED', compromisedAt, revokedAt: expect.any(String) });
    expect((safeJson(await h.client().post('/api/v1/verify', { code: before.code.data })) as any).state).toBe('INVALID_SIGNATURE');
    expect((await admin.post('/api/admin/keys/1/revoke', { reason: 'again' })).statusCode).toBe(409);
    expect((await admin.post('/api/admin/keys/1/revoke', { reason: 'x', compromisedAt: 'yesterday' })).statusCode).toBe(400);

    const retire = await admin.post('/api/admin/keys/2/retire');
    expect(retire.statusCode).toBe(200);
    expect(safeJson(retire)).toMatchObject({ keyId: 2, status: 'RETIRED' });
    expect((await admin.post('/api/admin/keys/2/retire')).statusCode).toBe(409);
    expect((await admin.post('/api/admin/keys/999/retire')).statusCode).toBe(400);
    expect((await admin.post('/api/admin/keys/77/retire')).statusCode).toBe(404);

    // Without an active key, issuance is unavailable (503) until the next rotation.
    const res = await h.client().get('/api/v1/keys');
    expect((safeJson(res) as any).keys.every((k: any) => k.status !== 'ACTIVE')).toBe(true);
    await expect(issue(h.ctx, catalog)).rejects.toMatchObject({ code: 'NO_ACTIVE_KEY', httpStatus: 503 });
    expect((await admin.post('/api/admin/keys/rotate')).statusCode).toBe(201);
  });

  it('dispatches revocations to codes, products and keys', async () => {
    const a = await issue(h.ctx, catalog);
    const b = await issue(h.ctx, catalog);

    const code = await admin.post('/api/admin/revocations', { targetType: 'CODE', targetId: a.code.id, reason: 'artwork leak' });
    expect(code.statusCode, code.body).toBe(201);
    expect(safeJson(code)).toMatchObject({ targetType: 'CODE', targetId: a.code.id, reasonCode: 'CODE_REVOKED', reason: 'artwork leak' });

    const product = await admin.post('/api/admin/revocations', { targetType: 'PRODUCT', targetId: b.product.id, reason: 'counterfeit seized' });
    expect(product.statusCode, product.body).toBe(201);
    expect(safeJson(product)).toMatchObject({ targetType: 'PRODUCT', targetId: b.product.productId });
    expect((safeJson(await h.client().post('/api/v1/verify', { code: b.code.data })) as any).state).toBe('REVOKED');

    const active = (safeJson(await auditor.get('/api/admin/keys')) as any).items.find((k: any) => k.status === 'ACTIVE');
    const key = await admin.post('/api/admin/revocations', { targetType: 'KEY', targetId: String(active.keyId), reason: 'drill' });
    expect(key.statusCode, key.body).toBe(201);
    expect(safeJson(key)).toMatchObject({ targetType: 'KEY', targetId: String(active.keyId), reasonCode: 'KEY_REVOKED' });

    expect((await admin.post('/api/admin/revocations', { targetType: 'KEY', targetId: 'abc', reason: 'x' })).statusCode).toBe(400);
    expect((await admin.post('/api/admin/revocations', { targetType: 'CODE', targetId: 'abc', reason: 'x' })).statusCode).toBe(400);
    expect((await admin.post('/api/admin/revocations', { targetType: 'USER', targetId: 'abc', reason: 'x' })).statusCode).toBe(400);
    expect((await admin.post('/api/admin/revocations', { targetType: 'CODE', targetId: a.code.id, reason: '' })).statusCode).toBe(400);

    const list = safeJson(await auditor.get('/api/admin/revocations?pageSize=10')) as any;
    expect(list.total).toBeGreaterThanOrEqual(3);
    expect(new Set(list.items.map((r: any) => r.targetType))).toEqual(new Set(['CODE', 'PRODUCT', 'KEY']));
  });

  it('lists the audit log with filters and verifies the hash chain', async () => {
    const page = safeJson(await auditor.get('/api/admin/audit?pageSize=5')) as any;
    expect(page.items).toHaveLength(5);
    expect(page.items[0].id).toBeGreaterThan(page.items[4].id); // newest first
    expect(page.items[0].hash).toMatch(/^[0-9a-f]{64}$/);

    const rotations = safeJson(await auditor.get('/api/admin/audit?action=key.rotate')) as any;
    expect(rotations.total).toBeGreaterThanOrEqual(2);
    for (const e of rotations.items) expect(e.action).toBe('key.rotate');
    // Admin mutations carry the admin id and the hashed client IP.
    const byAdmin = rotations.items.filter((e: any) => e.actorType === 'admin');
    expect(byAdmin.length).toBeGreaterThanOrEqual(1);
    for (const e of byAdmin) expect(e.ipHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await auditor.get('/api/admin/audit?action=drop table')).statusCode).toBe(400);

    const verify = await auditor.get('/api/admin/audit/verify');
    expect(verify.statusCode).toBe(200);
    const v = safeJson(verify) as any;
    expect(v.ok).toBe(true);
    expect(v.checked).toBeGreaterThan(0);
    expect(v.head).toMatchObject({ id: expect.any(Number), hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });
});
