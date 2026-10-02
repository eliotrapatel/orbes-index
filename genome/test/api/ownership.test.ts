import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { accountClient, createHarness, errorOf, issue, safeJson, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

describe('ownership API', () => {
  let h: Harness;
  let catalog: Catalog;

  beforeAll(async () => {
    h = await createHarness();
    catalog = await seedCatalog(h.ctx);
  });
  afterAll(() => h?.close());

  /** An ACTIVATED product (warranty started) ready for first registration. */
  async function sellable(withClaimSecret: boolean) {
    const p = await issue(h.ctx, catalog, { withClaimSecret });
    await h.ctx.services.warranty.activate(p.product.productId, { retailer: 'ORBES RUE SAINT-HONORÉ', country: 'FR' }, SYSTEM_ACTOR);
    return p;
  }

  async function scanForToken(c: Client, data: string) {
    const res = await c.post('/api/v1/verify', { code: data });
    const body = safeJson(res) as any;
    expect(body.state).toBe('AUTHENTIC_FIRST_REGISTRATION');
    return body.registration as { token: string; expiresAt: string; claimCodeRequired: boolean };
  }

  it('first registration with a claim code, then transfer to a second owner', async () => {
    const p = await sellable(true);
    const a = (await accountClient(h)).client;
    const b = (await accountClient(h)).client;

    const reg = await scanForToken(a, p.code.data);
    expect(reg.claimCodeRequired).toBe(true);
    expect(reg.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const wrong = await a.post('/api/v1/ownership/register', { registrationToken: reg.token, claimCode: 'AAAA-AAAA-AAAA' });
    expect(wrong.statusCode).toBe(403);
    expect(errorOf(wrong).code).toBe('CLAIM_CODE_INVALID');

    const ok = await a.post('/api/v1/ownership/register', { registrationToken: reg.token, claimCode: p.claimCode });
    expect(ok.statusCode).toBe(201);
    expect(safeJson(ok)).toMatchObject({ productId: p.product.productId, verified: true });
    expect(ok.body).not.toMatch(/OWNED|ACTIVATED|status/); // no internal statuses

    const reused = await a.post('/api/v1/ownership/register', { registrationToken: reg.token, claimCode: p.claimCode });
    expect(reused.statusCode).toBe(409);

    const mine = safeJson(await a.get('/api/v1/account/products')) as { products: any[] };
    expect(mine.products).toHaveLength(1);
    expect(mine.products[0]).toMatchObject({
      productId: p.product.productId,
      verified: true,
      genome: { fingerprint: p.genome.fingerprint },
      warranty: { status: 'ACTIVE' },
    });

    // Transfer A → B.
    const offer = await a.post('/api/v1/ownership/transfers', { productId: p.product.productId });
    expect(offer.statusCode).toBe(201);
    const { transferCode, expiresAt } = safeJson(offer) as { transferCode: string; expiresAt: string };
    expect(transferCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(h.ctx.clock().getTime());
    expect((await a.post('/api/v1/ownership/transfers', { productId: p.product.productId })).statusCode).toBe(409);

    const notTheOwner = await b.post('/api/v1/ownership/transfers', { productId: p.product.productId });
    expect(notTheOwner.statusCode).toBe(403);

    const badCode = await b.post('/api/v1/ownership/transfers/accept', { transferCode: '0000-0000-0000' });
    expect(badCode.statusCode).toBe(404);
    const accepted = await b.post('/api/v1/ownership/transfers/accept', { transferCode });
    expect(accepted.statusCode).toBe(200);
    expect(safeJson(accepted)).toMatchObject({ productId: p.product.productId, verified: true });

    expect((safeJson(await a.get('/api/v1/account/products')) as any).products).toHaveLength(0);
    expect((safeJson(await b.get('/api/v1/account/products')) as any).products).toHaveLength(1);

    // B starts a transfer and withdraws it; A can no longer act on the product.
    expect((await b.post('/api/v1/ownership/transfers', { productId: p.product.productId })).statusCode).toBe(201);
    expect((await a.post('/api/v1/ownership/transfers/cancel', { productId: p.product.productId })).statusCode).toBe(403);
    const cancel = await b.post('/api/v1/ownership/transfers/cancel', { productId: p.product.productId });
    expect(cancel.statusCode).toBe(200);
    expect(safeJson(cancel)).toEqual({ ok: true });
    expect((await b.post('/api/v1/ownership/transfers/cancel', { productId: p.product.productId })).statusCode).toBe(404);
  });

  it('registration without a claim secret is unverified; tokens are bound to a fresh scan', async () => {
    const p = await sellable(false);
    const a = (await accountClient(h)).client;
    const reg = await scanForToken(a, p.code.data);
    expect(reg.claimCodeRequired).toBe(false);
    const ok = await a.post('/api/v1/ownership/register', { registrationToken: reg.token });
    expect(ok.statusCode).toBe(201);
    expect((safeJson(ok) as any).verified).toBe(false);

    const bogus = await a.post('/api/v1/ownership/register', { registrationToken: 'A'.repeat(43) });
    expect(bogus.statusCode).toBe(400);
    expect(errorOf(bogus).code).toBe('REGISTRATION_TOKEN_INVALID');
    const malformed = await a.post('/api/v1/ownership/register', { registrationToken: 'not a token!' });
    expect(malformed.statusCode).toBe(400);
    expect(errorOf(malformed).code).toBe('VALIDATION_FAILED');
  });

  it('owner-only service history and incident reports', async () => {
    const p = await sellable(false);
    const owner = (await accountClient(h)).client;
    const stranger = (await accountClient(h)).client;
    const reg = await scanForToken(owner, p.code.data);
    expect((await owner.post('/api/v1/ownership/register', { registrationToken: reg.token })).statusCode).toBe(201);

    const svc = await h.ctx.services.warranty.openService(p.product.productId, { type: 'POLISH', location: 'Paris atelier', notes: 'internal note' }, SYSTEM_ACTOR);
    await h.ctx.services.warranty.completeService(svc.id, { notes: 'done' }, SYSTEM_ACTOR);

    const history = await owner.get(`/api/v1/products/${p.product.productId}/service-history`);
    expect(history.statusCode).toBe(200);
    const body = safeJson(history) as { productId: string; services: any[] };
    expect(body.productId).toBe(p.product.productId);
    expect(body.services).toHaveLength(1);
    expect(body.services[0]).toMatchObject({ type: 'POLISH', status: 'COMPLETED', location: 'Paris atelier' });
    expect(history.body).not.toContain('internal note'); // staff notes stay internal

    expect((await stranger.get(`/api/v1/products/${p.product.productId}/service-history`)).statusCode).toBe(403);
    // Unknown ids answer like products of someone else (no enumeration of issued serials).
    expect((await owner.get('/api/v1/products/O26-J-99999/service-history')).statusCode).toBe(403);
    expect((await owner.get('/api/v1/products/not-a-product/service-history')).statusCode).toBe(400);

    expect((await stranger.post('/api/v1/ownership/incidents', { productId: p.product.productId, type: 'STOLEN' })).statusCode).toBe(403);
    const bad = await owner.post('/api/v1/ownership/incidents', { productId: p.product.productId, type: 'BROKEN' });
    expect(bad.statusCode).toBe(400);
    const report = await owner.post('/api/v1/ownership/incidents', { productId: p.product.productId, type: 'STOLEN' });
    expect(report.statusCode).toBe(201);
    expect(safeJson(report)).toMatchObject({ productId: p.product.productId, type: 'STOLEN' });

    const after = await h.client().post('/api/v1/verify', { code: p.code.data });
    expect((safeJson(after) as any).state).toBe('SUSPICIOUS_ACTIVITY');
  });

  it('MY PIECES (F-01): the owner lists, reports LOST, then withdraws it (PIECE FOUND); a STOLEN stays with Client Services', async () => {
    const lost = await sellable(true);
    const stolen = await sellable(true);
    const owner = (await accountClient(h)).client;
    const stranger = (await accountClient(h)).client;
    for (const p of [lost, stolen]) {
      const reg = await scanForToken(owner, p.code.data);
      expect((await owner.post('/api/v1/ownership/register', { registrationToken: reg.token, claimCode: p.claimCode })).statusCode).toBe(201);
    }

    expect((await owner.post('/api/v1/ownership/incidents', { productId: lost.product.productId, type: 'LOST' })).statusCode).toBe(201);
    expect((await owner.post('/api/v1/ownership/incidents', { productId: stolen.product.productId, type: 'STOLEN' })).statusCode).toBe(201);
    const listed = (safeJson(await owner.get('/api/v1/account/products')) as { products: any[] }).products;
    const byId = new Map(listed.map((p) => [p.productId, p]));
    expect(byId.get(lost.product.productId)).toMatchObject({ incident: 'LOST', incidentResolvable: true });
    expect(byId.get(stolen.product.productId)).toMatchObject({ incident: 'STOLEN', incidentResolvable: false });
    // A stranger's scan of the lost piece: UNUSUAL ACTIVITY.
    expect((safeJson(await h.client().post('/api/v1/verify', { code: lost.code.data })) as any).state).toBe('SUSPICIOUS_ACTIVITY');

    // Only the owner; an unknown id answers alike; the body is the one of a transfer cancel.
    expect(errorOf(await stranger.post('/api/v1/ownership/incidents/resolve', { productId: lost.product.productId })).code).toBe('NOT_OWNER');
    expect((await stranger.post('/api/v1/ownership/incidents/resolve', { productId: 'O26-J-99999' })).statusCode).toBe(403);
    expect((await owner.post('/api/v1/ownership/incidents/resolve', { productId: lost.product.productId, type: 'LOST' })).statusCode).toBe(400);
    expect((await owner.post('/api/v1/ownership/incidents/resolve', {})).statusCode).toBe(400);

    const theft = await owner.post('/api/v1/ownership/incidents/resolve', { productId: stolen.product.productId });
    expect(theft.statusCode).toBe(409);
    expect(errorOf(theft)).toEqual({ code: 'INCIDENT_NOT_RESOLVABLE', message: 'Only a loss you reported yourself can be withdrawn here. ORBES Client Services can assist you.' });

    const found = await owner.post('/api/v1/ownership/incidents/resolve', { productId: lost.product.productId });
    expect(found.statusCode).toBe(200);
    const body = safeJson(found) as { productId: string; type: string; resolvedAt: string };
    expect(body).toEqual({ productId: lost.product.productId, type: 'LOST', resolvedAt: expect.any(String) });
    expect(found.body).not.toMatch(/OWNED|REGISTERED|status/); // no internal statuses
    expect((safeJson(await h.client().post('/api/v1/verify', { code: lost.code.data })) as any).state).toBe('AUTHENTIC_REGISTERED');
    const again = await owner.post('/api/v1/ownership/incidents/resolve', { productId: lost.product.productId });
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).code).toBe('NO_INCIDENT');

    // A session and the CSRF token, like every ownership mutation.
    expect((await h.client().post('/api/v1/ownership/incidents/resolve', { productId: lost.product.productId })).statusCode).toBe(401);
    expect(errorOf(await owner.post('/api/v1/ownership/incidents/resolve', { productId: stolen.product.productId }, { noCsrf: true })).code).toBe('CSRF_FAILED');
  });

  it('every ownership mutation needs a session and the CSRF token', async () => {
    const anon = h.client();
    expect((await anon.post('/api/v1/ownership/transfers', { productId: 'O26-J-00001' })).statusCode).toBe(401);
    const { client } = await accountClient(h);
    const noToken = await client.post('/api/v1/ownership/transfers', { productId: 'O26-J-00001' }, { noCsrf: true });
    expect(noToken.statusCode).toBe(403);
    expect(errorOf(noToken).code).toBe('CSRF_FAILED');
  });
});
