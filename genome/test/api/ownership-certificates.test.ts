/**
 * Ownership certificates over HTTP (F-06, API §8.7 and §11.7): the owner's routes behind the session and CSRF
 * rules, the public lookup and PDF with the token in the body, one 404 for an unknown and a withdrawn link, no
 * personal data in any public answer, and a certificate that ends with a transfer or a declaration.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeCertificateToken } from '../../src/server/services/ownership-certificates.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { accountClient, createHarness, errorOf, issue, ORIGIN, safeJson, scanToReceive, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

describe('ownership certificates API', () => {
  let h: Harness;
  let catalog: Catalog;

  beforeAll(async () => {
    h = await createHarness();
    catalog = await seedCatalog(h.ctx);
  });
  afterAll(() => h?.close());

  /** A piece sold, scanned and registered with its claim code by a new account (signed in, display name "Owner"). */
  async function ownedPiece() {
    const p = await issue(h.ctx, catalog, { withClaimSecret: true });
    await h.ctx.services.warranty.activate(p.product.productId, { retailer: 'ORBES RUE SAINT-HONORÉ', country: 'FR' }, SYSTEM_ACTOR);
    const owner = await accountClient(h);
    const scan = safeJson(await owner.client.post('/api/v1/verify', { code: p.code.data })) as { registration: { token: string } };
    const reg = await owner.client.post('/api/v1/ownership/register', { registrationToken: scan.registration.token, claimCode: p.claimCode });
    expect(reg.statusCode).toBe(201);
    return { p, owner };
  }

  const create = (c: Client, productId: string, validDays?: number) => c.post('/api/v1/ownership/certificates', { productId, ...(validDays !== undefined ? { validDays } : {}) });
  /** A visitor without any cookie: the buyer or the insurer who received the link. */
  const visitor = () => h.client({ origin: null });

  it('creates a link (shown once), lists it, and anyone holding it reads the live record: no name, email or account', async () => {
    const { p, owner } = await ownedPiece();
    const res = await create(owner.client, p.product.productId, 90);
    expect(res.statusCode).toBe(201);
    const offer = safeJson(res) as { id: string; productId: string; token: string; url: string; createdAt: string; expiresAt: string };
    expect(Object.keys(offer).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'productId', 'token', 'url']);
    expect(offer.productId).toBe(p.product.productId);
    expect(offer.url).toBe(`${ORIGIN}/verify/c#${offer.token}`);
    expect(Date.parse(offer.expiresAt) - Date.parse(offer.createdAt)).toBe(90 * 86_400_000);

    const list = safeJson(await owner.client.get('/api/v1/ownership/certificates')) as { certificates: unknown[] };
    expect(list.certificates).toEqual([{ id: offer.id, productId: p.product.productId, createdAt: offer.createdAt, expiresAt: offer.expiresAt, valid: true }]);

    const lookup = await visitor().post('/api/v1/certificates/lookup', { token: offer.token });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.headers['cache-control']).toBe('no-store');
    const body = safeJson(lookup) as Record<string, any>;
    expect(body).toMatchObject({
      status: 'VALID',
      certificate: { issuedAt: offer.createdAt, expiresAt: offer.expiresAt },
      piece: { productId: p.product.productId, model: 'MONOLITHE', type: 'RING', material: '925 STERLING SILVER', genome: { fingerprint: p.genome.fingerprint } },
      ownership: { verified: true },
      warranty: { status: 'ACTIVE' },
      incidentReported: false,
    });
    expect(Object.keys(body).sort()).toEqual(['certificate', 'checkedAt', 'incidentReported', 'ownership', 'piece', 'status', 'warranty']);
    expect(body.ownership.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // No personal data, and nothing that names the account, the ownership period or the certificate itself.
    const me = safeJson(await owner.client.get('/api/v1/account/me')) as { account: { email: string } };
    const accountRow = await h.ctx.db.selectFrom('accounts').select('id').where('email', '=', me.account.email).executeTakeFirstOrThrow();
    for (const secret of [me.account.email, 'Owner', accountRow.id, offer.id, offer.token]) expect(lookup.body).not.toContain(secret);
    expect(lookup.body).not.toMatch(/AUTHENTIC|email|displayName|account/i);
    // The owner's session changes nothing: the same record for everyone.
    const asOwner = safeJson(await owner.client.post('/api/v1/certificates/lookup', { token: offer.token })) as Record<string, any>;
    expect({ ...asOwner, checkedAt: '' }).toEqual({ ...body, checkedAt: '' });
  });

  it('sends the PDF as an attachment, never cached, with its live link', async () => {
    const { p, owner } = await ownedPiece();
    const offer = safeJson(await create(owner.client, p.product.productId)) as { token: string; url: string };
    const pdf = await visitor().post('/api/v1/certificates/pdf', { token: offer.token });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(new RegExp(`^attachment; filename="ORBES-ownership-certificate-${p.product.productId}-\\d{4}-\\d{2}-\\d{2}\\.pdf"$`));
    expect(pdf.headers['cache-control']).toBe('no-store');
    expect(pdf.rawPayload.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(pdf.rawPayload.toString('latin1')).toContain(`/URI (${offer.url})`);
  });

  it('answers an unknown, a malformed and a withdrawn link with the same 404, for the record and for the PDF', async () => {
    const { p, owner } = await ownedPiece();
    const offer = safeJson(await create(owner.client, p.product.productId)) as { id: string; token: string };
    // Another account cannot withdraw it.
    const stranger = (await accountClient(h)).client;
    const notTheirs = await stranger.request('DELETE', `/api/v1/ownership/certificates/${offer.id}`);
    expect(notTheirs.statusCode).toBe(404);
    expect(errorOf(notTheirs).code).toBe('CERTIFICATE_NOT_FOUND');

    const withdraw = await owner.client.request('DELETE', `/api/v1/ownership/certificates/${offer.id}`);
    expect(withdraw.statusCode).toBe(200);
    expect(safeJson(withdraw)).toEqual({ ok: true });
    expect((await owner.client.request('DELETE', `/api/v1/ownership/certificates/${offer.id}`)).statusCode).toBe(404);
    expect((safeJson(await owner.client.get('/api/v1/ownership/certificates')) as { certificates: unknown[] }).certificates).toEqual([]);

    const answers = [];
    for (const token of [offer.token, encodeCertificateToken(new Uint8Array(32).fill(3)), 'not-a-certificate']) {
      for (const route of ['lookup', 'pdf']) {
        const res = await visitor().post(`/api/v1/certificates/${route}`, { token });
        answers.push(`${res.statusCode} ${res.headers['content-type']} ${res.body}`);
      }
    }
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toMatch(/^404 application\/json; charset=utf-8 \{"error":\{"code":"CERTIFICATE_NOT_FOUND",/);
    const audit = await h.ctx.audit.list({ action: 'ownership.certificate.revoke', targetId: p.product.productId });
    expect(audit.items.map((e) => e.details)).toEqual([{ certificateId: offer.id }]);
  });

  it('is no longer valid once the piece changes hands, or is reported lost: no PDF then', async () => {
    const { p, owner } = await ownedPiece();
    const offer = safeJson(await create(owner.client, p.product.productId)) as { token: string };
    const { transferCode } = safeJson(await owner.client.post('/api/v1/ownership/transfers', { productId: p.product.productId })) as { transferCode: string };
    const buyer = (await accountClient(h)).client;
    expect((await buyer.post('/api/v1/ownership/transfers/accept', await scanToReceive(buyer, p.code.data, transferCode))).statusCode).toBe(200);
    const ended = await visitor().post('/api/v1/certificates/lookup', { token: offer.token });
    expect(ended.statusCode).toBe(200);
    expect(Object.keys(safeJson(ended) as object).sort()).toEqual(['checkedAt', 'status']);
    expect((safeJson(ended) as { status: string }).status).toBe('NO_LONGER_VALID');
    const pdf = await visitor().post('/api/v1/certificates/pdf', { token: offer.token });
    expect(pdf.statusCode).toBe(409);
    expect(errorOf(pdf).code).toBe('CERTIFICATE_NO_LONGER_VALID');

    // The new owner's own link, then a declaration of loss ends it.
    const theirs = safeJson(await create(buyer, p.product.productId)) as { token: string };
    expect((safeJson(await visitor().post('/api/v1/certificates/lookup', { token: theirs.token })) as { status: string }).status).toBe('VALID');
    expect((await buyer.post('/api/v1/ownership/incidents', { productId: p.product.productId, type: 'LOST' })).statusCode).toBe(201);
    expect((safeJson(await visitor().post('/api/v1/certificates/lookup', { token: theirs.token })) as { status: string }).status).toBe('NO_LONGER_VALID');
    const refused = await create(buyer, p.product.productId);
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused).code).toBe('CERTIFICATE_NOT_ALLOWED');
  });

  it('keeps the owner\'s routes behind the session, the CSRF token and the origin; the public ones need neither', async () => {
    const { p, owner } = await ownedPiece();
    const anon = h.client();
    expect((await anon.post('/api/v1/ownership/certificates', { productId: p.product.productId })).statusCode).toBe(401);
    expect((await anon.get('/api/v1/ownership/certificates')).statusCode).toBe(401);
    expect((await anon.request('DELETE', '/api/v1/ownership/certificates/00000000-0000-4000-8000-000000000000')).statusCode).toBe(401);

    const noToken = await owner.client.post('/api/v1/ownership/certificates', { productId: p.product.productId }, { noCsrf: true });
    expect(noToken.statusCode).toBe(403);
    expect(errorOf(noToken).code).toBe('CSRF_FAILED');
    const crossSite = await owner.client.post('/api/v1/ownership/certificates', { productId: p.product.productId }, { origin: 'https://evil.example' });
    expect(crossSite.statusCode).toBe(403);
    const offer = safeJson(await create(owner.client, p.product.productId)) as { id: string; token: string };
    const deleteNoToken = await owner.client.request('DELETE', `/api/v1/ownership/certificates/${offer.id}`, { noCsrf: true });
    expect(deleteNoToken.statusCode).toBe(403);
    expect(errorOf(deleteNoToken).code).toBe('CSRF_FAILED');
    expect((safeJson(await visitor().post('/api/v1/certificates/lookup', { token: offer.token })) as { status: string }).status).toBe('VALID');

    // Bodies are strict and bounded.
    for (const [body, field] of [
      [{ productId: p.product.productId, validDays: 91 }, 'validDays'],
      [{ productId: p.product.productId, validDays: 0 }, 'validDays'],
      [{ productId: p.product.productId, validDays: 7.5 }, 'validDays'],
      [{ productId: p.product.productId, owner: 'me' }, 'unknown'],
      [{ productId: 'nope' }, 'productId'],
    ] as const) {
      const res = await owner.client.post('/api/v1/ownership/certificates', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
      expect(errorOf(res).message).toMatch(new RegExp(field === 'unknown' ? 'unknown fields' : field));
    }
    expect((await visitor().post('/api/v1/certificates/lookup', {})).statusCode).toBe(400);
    expect((await visitor().post('/api/v1/certificates/lookup', { token: 'x'.repeat(129) })).statusCode).toBe(400);
    expect((await owner.client.request('DELETE', '/api/v1/ownership/certificates/not-a-uuid')).statusCode).toBe(400);
    // A stranger, and an unknown piece, are refused alike.
    const stranger = (await accountClient(h)).client;
    const a = await create(stranger, p.product.productId);
    const b = await create(stranger, 'O26-J-99999');
    expect(`${a.statusCode} ${a.body}`).toBe(`${b.statusCode} ${b.body}`);
    expect(errorOf(a).code).toBe('NOT_OWNER');
  });
});

describe('ownership certificates API: rate limits', () => {
  it('draws the public lookup and PDF from the `verify` budget, like a scan', async () => {
    const h = await createHarness({ config: { rateLimits: { verifyPerMinute: 3 } } });
    try {
      const c = h.client({ origin: null });
      const token = encodeCertificateToken(new Uint8Array(32).fill(1));
      const codes = [];
      for (let i = 0; i < 2; i++) codes.push((await c.post('/api/v1/certificates/lookup', { token })).statusCode);
      codes.push((await c.post('/api/v1/certificates/pdf', { token })).statusCode);
      const limited = await c.post('/api/v1/certificates/lookup', { token });
      codes.push(limited.statusCode);
      expect(codes).toEqual([404, 404, 404, 429]);
      expect(errorOf(limited).code).toBe('RATE_LIMITED');
    } finally {
      await h.close();
    }
  });
});
