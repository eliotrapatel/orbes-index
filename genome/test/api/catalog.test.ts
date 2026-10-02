/**
 * The editable catalogue (A-10): PATCH /api/admin/models/:id and
 * /api/admin/collections/:id (OPERATOR), POST
 * /api/admin/categories/:code/active (ADMIN). A model's name, care
 * instructions and collection are read live by every public result of its
 * pieces; its category and SKU prefix never change; an inactive model or
 * category issues no new piece (409) while its pieces verify as before.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IssueResult } from '../../src/server/services/issuance.js';
import { adminClient, createHarness, errorOf, issue, safeJson, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

interface ModelJson {
  id: string;
  name: string;
  type: string;
  skuPrefix: string;
  category: { code: string };
  collection: { id: string; name: string } | null;
  defaultMaterial: string | null;
  careInstructions: string | null;
  active: boolean;
  products: number;
}

describe('the editable catalogue (A-10)', () => {
  let h: Harness;
  let admin: Client;
  let operator: Client;
  let auditor: Client;
  let catalog: Catalog;
  let piece: IssueResult;

  const verify = async (code: string) =>
    safeJson(await h.client().post('/api/v1/verify', { code })) as { state: string; product?: { model: string; type: string; collection?: string; care?: string } };
  const modelOf = async (id: string) => ((safeJson(await auditor.get('/api/admin/models')) as { items: ModelJson[] }).items.find((m) => m.id === id))!;
  const issueViaApi = (c: Client) => c.post('/api/admin/products', { categoryCode: 'J', modelId: catalog.modelId, material: '925 STERLING SILVER' });

  beforeAll(async () => {
    h = await createHarness();
    admin = await adminClient(h, 'ADMIN');
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    catalog = await seedCatalog(h.ctx);
    piece = await issue(h.ctx, catalog);
  });
  afterAll(() => h?.close());

  it('lists each model active, with the pieces issued with it, and each collection with the pieces it is shown on', async () => {
    expect(await modelOf(catalog.modelId)).toMatchObject({ name: 'MONOLITHE', active: true, products: 1, careInstructions: 'Polish with a soft dry cloth.' });
    const cols = (safeJson(await auditor.get('/api/admin/collections')) as { items: { id: string; models: number; products: number }[] }).items;
    expect(cols.find((c) => c.id === catalog.collectionId)).toMatchObject({ models: 1, products: 1 });
  });

  it('PATCH /api/admin/models/:id: /verify reads the new name, care instructions and collection at once', async () => {
    expect((await verify(piece.code.data)).product).toMatchObject({ model: 'MONOLITHE', care: 'Polish with a soft dry cloth.' });
    const other = safeJson(await operator.post('/api/admin/collections', { name: 'ECLIPSE' })) as { id: string };
    const res = await operator.patch(`/api/admin/models/${catalog.modelId.toUpperCase()}`, {
      name: 'MONOLITHE II',
      careInstructions: 'Store it on its own, away from humidity, perfume and cosmetics.',
      collectionId: other.id,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(safeJson(res)).toMatchObject({
      id: catalog.modelId,
      name: 'MONOLITHE II',
      type: 'RING',
      careInstructions: 'Store it on its own, away from humidity, perfume and cosmetics.',
      collection: { id: other.id, name: 'ECLIPSE' },
      active: true,
      products: 1,
    });
    const after = await verify(piece.code.data);
    expect(after.state).toMatch(/^AUTHENTIC/);
    expect(after.product).toMatchObject({ model: 'MONOLITHE II', type: 'RING', collection: 'ECLIPSE', care: 'Store it on its own, away from humidity, perfume and cosmetics.' });

    // Cleared care instructions leave the result without them (/verify then shows its general care text).
    expect((await operator.patch(`/api/admin/models/${catalog.modelId}`, { careInstructions: '' })).statusCode).toBe(200);
    expect((await verify(piece.code.data)).product?.care).toBeUndefined();
    expect((await operator.patch(`/api/admin/models/${catalog.modelId}`, { careInstructions: 'Polish with a soft dry cloth.', collectionId: catalog.collectionId })).statusCode).toBe(200);

    // Audited with the admin, the hashed IP, and the fields before and after.
    const rows = await h.ctx.db.selectFrom('audit_logs').selectAll().where('action', '=', 'model.update').orderBy('id').execute();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ actor_type: 'admin', target_type: 'model', target_id: catalog.modelId });
    expect(rows[0].ip_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rows[0].details).toEqual({
      before: { name: 'MONOLITHE', careInstructions: 'Polish with a soft dry cloth.', collectionId: catalog.collectionId },
      after: { name: 'MONOLITHE II', careInstructions: 'Store it on its own, away from humidity, perfume and cosmetics.', collectionId: other.id },
      issuedPieces: 1,
    });
  });

  it('refuses a model\'s category and SKU prefix (400), any other field, and an empty change', async () => {
    for (const body of [{ skuPrefix: 'NEW-RG' }, { categoryCode: 'L' }, { category: 'L', name: 'X' }]) {
      const res = await operator.patch(`/api/admin/models/${catalog.modelId}`, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(errorOf(res)).toEqual({ code: 'VALIDATION_FAILED', message: expect.stringMatching(/never change: the category letter is in the identity of every piece issued with it, the prefix starts every SKU issued with it\.$/) });
    }
    for (const body of [{ type: 'PENDANT' }, {}, { name: '' }, { active: 'false' }, { collectionId: 'nope' }]) {
      const res = await operator.patch(`/api/admin/models/${catalog.modelId}`, body);
      expect([res.statusCode, errorOf(res).code], JSON.stringify(body)).toEqual([400, 'VALIDATION_FAILED']);
    }
    expect(errorOf(await operator.patch(`/api/admin/models/${catalog.modelId}`, {})).message).toBe('Send at least one field of the model to change.');
    expect(errorOf(await operator.patch(`/api/admin/models/${catalog.modelId}`, { type: 'PENDANT' })).message).toMatch(/unknown fields: type/);
    expect(errorOf(await operator.patch('/api/admin/models/00000000-0000-4000-8000-000000000000', { name: 'X' })).code).toBe('MODEL_NOT_FOUND');
    expect(errorOf(await operator.patch(`/api/admin/models/${catalog.modelId}`, { collectionId: '00000000-0000-4000-8000-000000000000' })).code).toBe('COLLECTION_NOT_FOUND');
    expect(await modelOf(catalog.modelId)).toMatchObject({ name: 'MONOLITHE II', skuPrefix: expect.stringMatching(/^MNL-/), category: { code: 'J' } });
    // A mutation: the CSRF token is required, and an AUDITOR may not.
    expect((await operator.patch(`/api/admin/models/${catalog.modelId}`, { name: 'X' }, { noCsrf: true })).statusCode).toBe(403);
    expect(errorOf(await auditor.patch(`/api/admin/models/${catalog.modelId}`, { name: 'X' })).code).toBe('FORBIDDEN');
  });

  it('an inactive model issues no new piece (409 MODEL_INACTIVE); its pieces verify as before', async () => {
    const off = await operator.patch(`/api/admin/models/${catalog.modelId}`, { active: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(await modelOf(catalog.modelId)).toMatchObject({ active: false, products: 1 });
    const refused = await issueViaApi(operator);
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused)).toEqual({ code: 'MODEL_INACTIVE', message: 'This model is no longer offered for new products.' });
    expect((await verify(piece.code.data)).state).toMatch(/^AUTHENTIC/);

    expect((await operator.patch(`/api/admin/models/${catalog.modelId}`, { active: true })).statusCode).toBe(200);
    expect((await issueViaApi(operator)).statusCode).toBe(201);
    expect((await modelOf(catalog.modelId)).products).toBe(2);
  });

  it('PATCH /api/admin/collections/:id renames a collection: /verify reads the new name', async () => {
    const res = await operator.patch(`/api/admin/collections/${catalog.collectionId}`, { name: 'ORBIT NOIR' });
    expect(res.statusCode, res.body).toBe(200);
    expect(safeJson(res)).toMatchObject({ id: catalog.collectionId, name: 'ORBIT NOIR', models: 1, products: 2 });
    expect((await verify(piece.code.data)).product?.collection).toBe('ORBIT NOIR');
    const entry = await h.ctx.db.selectFrom('audit_logs').selectAll().where('action', '=', 'collection.update').executeTakeFirstOrThrow();
    expect(entry).toMatchObject({ actor_type: 'admin', target_type: 'collection', target_id: catalog.collectionId });
    expect(entry.details).toMatchObject({ after: { name: 'ORBIT NOIR' }, issuedPieces: 2 });

    expect(errorOf(await operator.patch(`/api/admin/collections/${catalog.collectionId}`, { name: 'ECLIPSE' })).code).toBe('COLLECTION_EXISTS');
    expect(errorOf(await operator.patch('/api/admin/collections/00000000-0000-4000-8000-000000000000', { name: 'X' })).code).toBe('COLLECTION_NOT_FOUND');
    expect(errorOf(await operator.patch(`/api/admin/collections/${catalog.collectionId}`, { name: 'X', models: 3 })).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await auditor.patch(`/api/admin/collections/${catalog.collectionId}`, { name: 'X' })).code).toBe('FORBIDDEN');
  });

  it('POST /api/admin/categories/:code/active (ADMIN): a deactivated category issues no new piece, its pieces verify', async () => {
    // The console's list counts the pieces issued in each category: what its Deactivate dialog says first.
    const issuedInJ = Number(
      (await h.ctx.db.selectFrom('products').select((eb) => eb.fn.countAll<number>().as('n')).where('category_id', '=', 1).executeTakeFirstOrThrow()).n,
    );
    expect(issuedInJ).toBeGreaterThan(0);
    const listed = safeJson(await auditor.get('/api/admin/categories')) as { items: { code: string; products: number }[] };
    expect(listed.items.find((c) => c.code === 'J')?.products).toBe(issuedInJ);
    expect(errorOf(await operator.post('/api/admin/categories/J/active', { active: false })).code).toBe('FORBIDDEN');
    const off = await admin.post('/api/admin/categories/j/active', { active: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(safeJson(off)).toMatchObject({ code: 'J', active: false, products: issuedInJ });
    // Asked again for the state it has: 200, nothing changes and nothing is audited.
    expect(safeJson(await admin.post('/api/admin/categories/J/active', { active: false }))).toMatchObject({ code: 'J', active: false });
    expect(errorOf(await issueViaApi(operator)).code).toBe('CATEGORY_INACTIVE');
    expect((await verify(piece.code.data)).state).toMatch(/^AUTHENTIC/);
    // The public list names the categories that accept new pieces; the console lists them all.
    expect((safeJson(await h.client().get('/api/v1/categories')) as { code: string }[]).map((c) => c.code)).not.toContain('J');
    expect((safeJson(await auditor.get('/api/admin/categories')) as { items: { code: string; active: boolean }[] }).items.find((c) => c.code === 'J')?.active).toBe(false);

    expect(safeJson(await admin.post('/api/admin/categories/J/active', { active: true }))).toMatchObject({ code: 'J', active: true });
    expect((await issueViaApi(operator)).statusCode).toBe(201);
    const actions = (await h.ctx.db.selectFrom('audit_logs').select('action').where('target_type', '=', 'category').where('target_id', '=', 'J').orderBy('id').execute()).map((r) => r.action);
    expect(actions.slice(-2)).toEqual(['category.deactivate', 'category.activate']);

    expect(errorOf(await admin.post('/api/admin/categories/Q/active', { active: true })).code).toBe('CATEGORY_NOT_FOUND');
    for (const [url, body] of [['/api/admin/categories/JJ/active', { active: true }], ['/api/admin/categories/J/active', { active: 'yes' }], ['/api/admin/categories/J/active', {}]] as const) {
      expect(errorOf(await admin.post(url, body)).code, `${url} ${JSON.stringify(body)}`).toBe('VALIDATION_FAILED');
    }
  });
});
