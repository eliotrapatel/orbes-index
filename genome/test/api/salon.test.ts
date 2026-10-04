/**
 * THE PRIVATE SALON (P-X08): the lookbook's RESERVED models, each with a price and the lowest tier it is shown to
 * (PATCH /api/admin/models/:id: `priceLabel`, `privateMinTier`, audited `model.update`); listed and opened for an owner
 * whose tier reaches the model (GET /api/v1/club/lookbook, /:slug: 404 below it), requested with REQUEST THIS PIECE
 * (POST /api/v1/club/lookbook/:slug/request: one open request per account and model, audited `shop.request` without
 * the note); the console's Requests tab (GET /api/admin/club/requests, AUDITOR, emails masked; POST …/:id/close,
 * OPERATOR, with a note, audited `shop.request.close`); the lock of an account closes its open requests, and the right
 * of access exports them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IssueResult } from '../../src/server/services/issuance.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { accountClient, adminClient, createHarness, errorOf, issue, safeJson, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

interface SalonCardJson {
  slug: string;
  name: string;
  priceLabel: string | null;
  minTier: number;
}

interface RequestJson {
  id: string;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
}

interface SheetJson {
  slug: string;
  lookbook: 'PUBLIC' | 'RESERVED';
  salon?: { priceLabel: string | null; minTier: number; request: RequestJson | null };
}

interface AdminRequestJson {
  id: string;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
  note: string | null;
  account: { id: string; email: string };
  model: { id: string; name: string; type: string; slug: string | null; priceLabel: string | null };
  handledBy: { id: string; email: string } | null;
  handledAt: string | null;
  resolutionNote: string | null;
}

describe('the private salon (P-X08)', () => {
  let h: Harness;
  let catalog: Catalog;
  let operator: Client;
  let auditor: Client;
  let admin: Client;
  /** RESERVED from TITANE, with a price; RESERVED from PLATINE, without one; PUBLIC. */
  let solstice: string;
  let eclipse: string;
  let aurore: string;
  let titane: { client: Client; email: string; id: string };
  let platine: { client: Client; email: string; id: string };

  const model = (id: string) => `/api/admin/models/${id}`;
  const audits = (action: string, targetId?: string) =>
    h.ctx.db.selectFrom('audit_logs').selectAll().where('action', '=', action).$if(targetId !== undefined, (q) => q.where('target_id', '=', targetId!)).orderBy('id').execute();
  const accountIdOf = async (email: string) => (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email.toLowerCase()).executeTakeFirstOrThrow()).id;
  const requestOf = (c: Client, slug: string, body?: unknown) => c.post(`/api/v1/club/lookbook/${slug}/request`, body);
  const statusOf = async (res: ReturnType<Client['get']>) => {
    const r = await res;
    return [r.statusCode, errorOf(r).code];
  };
  const adminRequests = async (c: Client, query = '') => {
    const res = await c.get(`/api/admin/club/requests${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return safeJson(res) as { items: AdminRequestJson[]; total: number };
  };

  async function ownedPiece(c: Client): Promise<IssueResult> {
    const p = await issue(h.ctx, catalog);
    await h.ctx.services.warranty.activate(p.product.productId, { retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    const scan = safeJson(await c.post('/api/v1/verify', { code: p.code.data })) as { registration: { token: string } };
    expect((await c.post('/api/v1/ownership/register', { registrationToken: scan.registration.token })).statusCode).toBe(201);
    return p;
  }

  async function member(pieces: number): Promise<{ client: Client; email: string; id: string }> {
    const a = await accountClient(h);
    for (let i = 0; i < pieces; i++) await ownedPiece(a.client);
    return { ...a, id: await accountIdOf(a.email) };
  }

  async function newModel(name: string): Promise<string> {
    const res = await operator.post('/api/admin/models', { categoryCode: 'J', name, type: 'PENDANT', skuPrefix: `SL-${name.slice(0, 6)}` });
    expect(res.statusCode, res.body).toBe(201);
    return (safeJson(res) as { id: string }).id;
  }

  beforeAll(async () => {
    h = await createHarness();
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    admin = await adminClient(h, 'ADMIN');
    catalog = await seedCatalog(h.ctx);
    solstice = await newModel('SOLSTICE');
    eclipse = await newModel('ECLIPSE');
    aurore = await newModel('AURORE');
    titane = await member(1);
    platine = await member(3);
  });
  afterAll(() => h?.close());

  it('the console sets a model\'s price and the lowest tier it is shown to, audited model.update; every model starts from TITANE without a price', async () => {
    const before = safeJson(await auditor.get(model(solstice))) as { priceLabel: string | null; privateMinTier: number };
    expect([before.priceLabel, before.privateMinTier]).toEqual([null, 1]);
    for (const [body, code] of [
      [{ priceLabel: 'x'.repeat(61) }, 'VALIDATION_FAILED'],
      [{ privateMinTier: 0 }, 'VALIDATION_FAILED'],
      [{ privateMinTier: 4 }, 'VALIDATION_FAILED'],
      [{ privateMinTier: 1.5 }, 'VALIDATION_FAILED'],
      [{ privateMinTier: '2' }, 'VALIDATION_FAILED'],
    ] as const) {
      const res = await operator.patch(model(solstice), body);
      expect([res.statusCode, errorOf(res).code], JSON.stringify(body)).toEqual([400, code]);
    }
    expect((await auditor.patch(model(solstice), { priceLabel: '€ 4 800' })).statusCode).toBe(403);
    const res = await operator.patch(model(solstice), { slug: 'solstice', lookbook: 'RESERVED', priceLabel: '  €   4 800 ' });
    expect(res.statusCode, res.body).toBe(200);
    expect(safeJson(res)).toMatchObject({ lookbook: 'RESERVED', priceLabel: '€ 4 800', privateMinTier: 1 });
    expect((await audits('model.update', solstice)).at(-1)!.details).toMatchObject({ before: { priceLabel: null }, after: { priceLabel: '€ 4 800' } });
    const tiered = await operator.patch(model(eclipse), { slug: 'eclipse', lookbook: 'RESERVED', privateMinTier: 2, story: 'For PLATINE.' });
    expect(safeJson(tiered)).toMatchObject({ priceLabel: null, privateMinTier: 2 });
    expect((await audits('model.update', eclipse)).at(-1)!.details).toMatchObject({ before: { privateMinTier: 1 }, after: { privateMinTier: 2 } });
    expect((await operator.patch(model(aurore), { slug: 'aurore', lookbook: 'PUBLIC', priceLabel: '€ 900' })).statusCode).toBe(200);
    // '' clears the price.
    const cleared = await operator.patch(model(aurore), { priceLabel: '' });
    expect((safeJson(cleared) as { priceLabel: string | null }).priceLabel).toBeNull();
  });

  it('shows each owner the RESERVED models its tier reaches, with their prices; 404 above it; nothing of it in public', async () => {
    const cards = async (c: Client) => {
      const res = await c.get('/api/v1/club/lookbook');
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      return (safeJson(res) as { models: SalonCardJson[] }).models;
    };
    expect((await cards(titane.client)).map((c) => [c.slug, c.priceLabel, c.minTier])).toEqual([['solstice', '€ 4 800', 1]]);
    expect((await cards(platine.client)).map((c) => [c.slug, c.priceLabel, c.minTier])).toEqual([
      ['eclipse', null, 2],
      ['solstice', '€ 4 800', 1],
    ]);
    // A PLATINE model above a TITANE reader: the same 404 as a model not shown.
    expect(await statusOf(titane.client.get('/api/v1/club/lookbook/eclipse'))).toEqual([404, 'LOOKBOOK_NOT_FOUND']);
    const sheet = safeJson(await platine.client.get('/api/v1/club/lookbook/eclipse')) as SheetJson & { story: string };
    expect(sheet).toMatchObject({ slug: 'eclipse', lookbook: 'RESERVED', story: 'For PLATINE.', salon: { priceLabel: null, minTier: 2, request: null } });
    // A PUBLIC sheet read through the club carries no salon; the public list and sheets never name a price.
    expect(safeJson(await titane.client.get('/api/v1/club/lookbook/aurore'))).not.toHaveProperty('salon');
    const pub = safeJson(await h.client().get('/api/v1/lookbook')) as { models: Record<string, unknown>[] };
    expect(pub.models.map((c) => c.slug)).toEqual(['aurore']);
    for (const c of pub.models) expect(Object.keys(c)).not.toEqual(expect.arrayContaining(['priceLabel']));
    expect(safeJson(await h.client().get('/api/v1/lookbook/aurore'))).not.toHaveProperty('salon');
    expect(errorOf(await h.client().get('/api/v1/lookbook/solstice')).code).toBe('LOOKBOOK_NOT_FOUND');
  });

  it('REQUEST THIS PIECE: an owner from the model\'s tier, once while it is open, with an optional note kept out of the audit log', async () => {
    const anonymous = await requestOf(h.client(), 'solstice');
    expect([anonymous.statusCode, errorOf(anonymous).code]).toEqual([401, 'UNAUTHORIZED']);
    const { client: stranger } = await accountClient(h);
    expect(await statusOf(requestOf(stranger, 'solstice'))).toEqual([403, 'OWNERS_ONLY']);
    expect(await statusOf(requestOf(titane.client, 'eclipse'))).toEqual([404, 'LOOKBOOK_NOT_FOUND']);
    const publicModel = await requestOf(titane.client, 'aurore');
    expect([publicModel.statusCode, errorOf(publicModel)]).toEqual([404, { code: 'NOT_IN_SALON', message: 'This model is not offered in the private salon.' }]);
    expect(errorOf(await requestOf(titane.client, 'nope')).code).toBe('LOOKBOOK_NOT_FOUND');
    expect((await requestOf(titane.client, 'solstice', { note: 'x'.repeat(501) })).statusCode).toBe(400);
    expect((await requestOf(titane.client, 'solstice', { price: 1 })).statusCode).toBe(400);

    const res = await requestOf(titane.client, 'solstice', { note: '  A size 52, and a call after six.  ' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const { request } = safeJson(res) as { request: RequestJson };
    expect(request).toEqual({ id: expect.any(String), status: 'OPEN', createdAt: h.clock.now().toISOString() });
    expect(await h.ctx.db.selectFrom('shop_requests').select(['account_id', 'model_id', 'note', 'status']).where('id', '=', request.id).executeTakeFirstOrThrow()).toEqual({
      account_id: titane.id,
      model_id: solstice,
      note: 'A size 52, and a call after six.',
      status: 'OPEN',
    });
    const [entry] = await audits('shop.request', request.id);
    expect(entry).toMatchObject({ actor_type: 'account', actor_id: titane.id, target_type: 'shop_request', details: { modelId: solstice } });
    expect(JSON.stringify(entry!.details)).not.toContain('size 52');
    // Once while it is open; the sheet says it is requested.
    const again = await requestOf(titane.client, 'solstice');
    expect([again.statusCode, errorOf(again)]).toEqual([409, { code: 'SHOP_REQUEST_OPEN', message: 'You have already requested this piece: ORBES Client Services will contact you.' }]);
    expect((safeJson(await titane.client.get('/api/v1/club/lookbook/solstice')) as SheetJson).salon).toEqual({ priceLabel: '€ 4 800', minTier: 1, request });
    // Another account requests another model a minute later; the body may be left out.
    h.clock.advance(60_000);
    const other = await requestOf(platine.client, 'eclipse');
    expect(other.statusCode, other.body).toBe(201);
  });

  it('the console\'s Requests: OPEN first, emails masked for an AUDITOR; an OPERATOR closes one with a note, audited without it; then the account may request again', async () => {
    const all = await adminRequests(auditor);
    expect(all.total).toBe(2);
    expect(all.items.map((r) => [r.model.name, r.status])).toEqual([
      ['ECLIPSE', 'OPEN'],
      ['SOLSTICE', 'OPEN'],
    ]);
    const mine = all.items.find((r) => r.model.id === solstice)!;
    expect(mine).toMatchObject({ note: 'A size 52, and a call after six.', model: { slug: 'solstice', priceLabel: '€ 4 800', type: 'PENDANT' }, handledBy: null, handledAt: null, resolutionNote: null });
    expect(mine.account.id).toBe(titane.id);
    expect(mine.account.email).toMatch(/^.\*\*\*@/);
    expect((await adminRequests(operator)).items.find((r) => r.id === mine.id)!.account.email).toBe(titane.email.toLowerCase());
    expect(errorOf(await auditor.get('/api/admin/club/requests?status=PENDING')).code).toBe('VALIDATION_FAILED');

    const close = (c: Client, body: unknown, id = mine.id) => c.post(`/api/admin/club/requests/${id}/close`, body);
    expect((await close(auditor, { note: 'Called.' })).statusCode).toBe(403);
    expect((await close(operator, {})).statusCode).toBe(400);
    expect((await close(operator, { note: '   ' })).statusCode).toBe(400);
    expect(errorOf(await close(operator, { note: 'Called.' }, '5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6')).code).toBe('SHOP_REQUEST_NOT_FOUND');
    h.clock.advance(60_000);
    const closed = await close(operator, { note: 'Called the client: a fitting on Tuesday.' });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(safeJson(closed)).toMatchObject({ id: mine.id, status: 'CLOSED', handledBy: { email: expect.stringContaining('@') }, handledAt: h.clock.now().toISOString(), resolutionNote: 'Called the client: a fitting on Tuesday.' });
    const [entry] = await audits('shop.request.close', mine.id);
    expect(entry).toMatchObject({ actor_type: 'admin', target_type: 'shop_request', details: { modelId: solstice } });
    expect(JSON.stringify(entry!.details)).not.toContain('fitting');
    expect(errorOf(await close(operator, { note: 'Again.' })).code).toBe('SHOP_REQUEST_CLOSED');
    expect((await adminRequests(auditor, '?status=CLOSED')).items.map((r) => r.id)).toEqual([mine.id]);
    expect((await adminRequests(auditor, '?status=OPEN')).items.map((r) => r.model.name)).toEqual(['ECLIPSE']);
    // Closed, the sheet offers the request again, and the account may make it.
    expect((safeJson(await titane.client.get('/api/v1/club/lookbook/solstice')) as SheetJson).salon!.request).toBeNull();
    h.clock.advance(60_000);
    expect((await requestOf(titane.client, 'solstice')).statusCode).toBe(201);
  });

  it('the lock of an account closes its open requests (by the lock\'s ADMIN, without a note); the right of access exports every request, never who closed it', async () => {
    h.clock.advance(60_000);
    const locked = await admin.post(`/api/admin/owners/${titane.id}/lock`);
    expect(locked.statusCode, locked.body).toBe(200);
    expect(safeJson(locked)).toMatchObject({ status: 'LOCKED', shopRequestsClosed: 1 });
    const rows = await h.ctx.db.selectFrom('shop_requests').select(['id', 'status', 'handled_by', 'handled_at', 'resolution_note']).where('account_id', '=', titane.id).orderBy('created_at').orderBy('id').execute();
    expect(rows.map((r) => r.status)).toEqual(['CLOSED', 'CLOSED']);
    const byLock = rows.find((r) => r.resolution_note === null)!;
    expect(byLock.handled_by).not.toBeNull();
    expect((await audits('shop.request.close', byLock.id))[0]!.details).toEqual({ modelId: solstice, reason: 'account_locked' });
    expect((await audits('account.lock', titane.id))[0]!.details).toMatchObject({ shopRequestsClosed: 1 });
    // The other account's request stays open.
    expect((await adminRequests(auditor, '?status=OPEN')).items.map((r) => r.account.id)).toEqual([platine.id]);

    const exported = safeJson(await admin.get(`/api/admin/owners/${titane.id}/export`)) as { shopRequests: Record<string, unknown>[] };
    expect(exported.shopRequests).toEqual([
      expect.objectContaining({ modelId: solstice, model: 'SOLSTICE', note: 'A size 52, and a call after six.', status: 'CLOSED', resolutionNote: 'Called the client: a fitting on Tuesday.' }),
      expect.objectContaining({ modelId: solstice, model: 'SOLSTICE', note: null, status: 'CLOSED', resolutionNote: null }),
    ]);
    for (const r of exported.shopRequests) expect(Object.keys(r).sort()).toEqual(['handledAt', 'model', 'modelId', 'note', 'requestId', 'requestedAt', 'resolutionNote', 'status']);
    expect((await audits('account.export', titane.id))[0]!.details).toMatchObject({ shopRequests: 2 });
  });

  it('the access goes with the pieces: an owner whose tier falls below a model no longer reads it nor requests it', async () => {
    // ECLIPSE from PALLADIUM: above the PLATINE account now.
    expect((await operator.patch(model(eclipse), { privateMinTier: 3 })).statusCode).toBe(200);
    expect(errorOf(await platine.client.get('/api/v1/club/lookbook/eclipse')).code).toBe('LOOKBOOK_NOT_FOUND');
    expect(((safeJson(await platine.client.get('/api/v1/club/lookbook')) as { models: SalonCardJson[] }).models).map((c) => c.slug)).toEqual(['solstice']);
    expect(errorOf(await requestOf(platine.client, 'eclipse')).code).toBe('LOOKBOOK_NOT_FOUND');
  });
});
