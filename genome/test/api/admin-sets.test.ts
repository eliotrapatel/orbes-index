/**
 * THE SET's catalogue over HTTP (macro scope of 2026-10-20, K44 T1; plan MACRO M3 §5.2, step M3.14; routes/admin/sets.ts):
 * an AUDITOR reads the list and one set, an OPERATOR makes, changes, sets aside, reinstates and links a set to Shopify,
 * as the models and the add-ons; an AUDITOR and a LOGISTICS login are refused the writes, LOGISTICS the reads too; the
 * bodies are strict, and the service's refusals answer as it says (test/services/sets.test.ts holds the service).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, createHarness, errorOf, safeJson, seedCatalog, type Client, type Harness } from './support.js';
import { giveSizes } from '../support/draws.js';

/** A PUT with its body (the harness's client has no shorthand for it). */
const put = (c: Client, url: string, body: unknown) => c.request('PUT', url, { body });

interface SetBody {
  id: string;
  name: string;
  code: string;
  active: boolean;
  basePriceMinor: number | null;
  baseCurrency: string | null;
  shopifyProductId: string | null;
  pieces: { position: number; model: { id: string } }[];
}

describe('the sets\' routes (plan MACRO M3 §5.2, T1)', () => {
  let h: Harness;
  let operator: Client;
  let auditor: Client;
  let agent: Client;
  const models: string[] = [];

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-22T09:00:00.000Z');
    await seedCatalog(h.ctx);
    const category = (await h.ctx.categories.getByCode('J'))!.index;
    for (const name of ['HALO', 'LINEA', 'NOVA']) {
      const m = await h.ctx.db
        .insertInto('models')
        .values({ category_id: category, name, type: 'RING', sku_prefix: `${name}-${randomUUID().slice(0, 6).toUpperCase()}` })
        .returning('id')
        .executeTakeFirstOrThrow();
      await giveSizes(h.ctx.db, m.id, ['52', '54']);
      models.push(m.id);
    }
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    agent = await adminClient(h, 'LOGISTICS');
  });
  afterAll(() => h?.close());

  it('an OPERATOR makes, changes, sets aside, reinstates and links a set; an AUDITOR reads; the writes refused to an AUDITOR and LOGISTICS', async () => {
    const created = await operator.post('/api/admin/sets', { name: 'The Pair', code: 'the-pair', modelIds: [models[0], models[1]], basePriceMinor: 90_000, baseCurrency: 'EUR' });
    expect(created.statusCode, created.body).toBe(201);
    const s = safeJson(created) as SetBody;
    expect(s).toMatchObject({ name: 'The Pair', code: 'THE-PAIR', basePriceMinor: 90_000, baseCurrency: 'EUR', active: true, pieces: [{ position: 1, model: { id: models[0] } }, { position: 2, model: { id: models[1] } }] });
    // The service's refusals, as it says them.
    expect(errorOf(await operator.post('/api/admin/sets', { name: 'the pair', code: 'OTHER', modelIds: [models[0], models[1]] }))).toEqual({ code: 'SET_NAME_TAKEN', message: 'Another set has this name.' });
    expect(errorOf(await operator.post('/api/admin/sets', { name: 'Alone', code: 'ALONE', modelIds: [models[0]] })).code).toBe('SET_MODELS');
    expect((await operator.post('/api/admin/sets', { name: 'Alone', code: 'ALONE', modelIds: [models[0]] })).statusCode).toBe(422);
    // Strict bodies: an unknown field, a price without its currency, a currency the house does not sell in, no pieces.
    for (const bad of [
      { name: 'X', code: 'X1', modelIds: [models[0], models[1]], active: false },
      { name: 'X', code: 'X1', modelIds: [models[0], models[1]], basePriceMinor: 100 },
      { name: 'X', code: 'X1', modelIds: [models[0], models[1]], basePriceMinor: 100, baseCurrency: 'JPY' },
      { name: 'X', code: 'X1' },
      { name: 'X', code: 'X1', modelIds: ['nope', models[1]] },
    ]) {
      expect(errorOf(await operator.post('/api/admin/sets', bad)).code, JSON.stringify(bad)).toBe('VALIDATION_FAILED');
    }

    const patched = await operator.patch(`/api/admin/sets/${s.id}`, { modelIds: [models[1], models[0], models[2]], basePriceMinor: null, baseCurrency: null });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(safeJson(patched)).toMatchObject({ basePriceMinor: null, pieces: [{ model: { id: models[1] } }, { model: { id: models[0] } }, { model: { id: models[2] } }] });
    expect(errorOf(await operator.patch(`/api/admin/sets/${s.id}`, {})).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await operator.patch(`/api/admin/sets/${s.id}`, { active: false })).code).toBe('VALIDATION_FAILED');

    expect((safeJson(await operator.post(`/api/admin/sets/${s.id}/set-aside`)) as SetBody).active).toBe(false);
    expect((safeJson(await operator.post(`/api/admin/sets/${s.id}/reinstate`, {})) as SetBody).active).toBe(true);

    const linked = await put(operator, `/api/admin/sets/${s.id}/shopify`, { productId: 'https://admin.shopify.com/store/orbes/products/9001' });
    expect(linked.statusCode, linked.body).toBe(200);
    expect((safeJson(linked) as SetBody).shopifyProductId).toBe('9001');
    expect(errorOf(await put(operator, `/api/admin/sets/${s.id}/shopify`, { productId: '9001', variantId: '1' })).code).toBe('VALIDATION_FAILED');

    // An AUDITOR reads the list and one set.
    const list = await auditor.get('/api/admin/sets');
    expect(list.statusCode).toBe(200);
    expect((safeJson(list) as { items: SetBody[] }).items.map((x) => x.name)).toEqual(['The Pair']);
    expect((safeJson(await auditor.get(`/api/admin/sets/${s.id}`)) as SetBody).code).toBe('THE-PAIR');
    expect(errorOf(await auditor.get('/api/admin/sets/00000000-0000-4000-8000-000000000000'))).toEqual({ code: 'SET_NOT_FOUND', message: expect.any(String) });
    expect((await auditor.get('/api/admin/sets/nope')).statusCode).toBe(400);
    // The writes are an OPERATOR's; LOGISTICS reads no set.
    expect(errorOf(await auditor.post('/api/admin/sets', { name: 'Y', code: 'Y1', modelIds: [models[0], models[1]] })).code).toBe('FORBIDDEN');
    expect(errorOf(await put(auditor, `/api/admin/sets/${s.id}/shopify`, { productId: null })).code).toBe('FORBIDDEN');
    expect(errorOf(await agent.get('/api/admin/sets')).code).toBe('FORBIDDEN');
    expect(errorOf(await agent.post(`/api/admin/sets/${s.id}/set-aside`)).code).toBe('FORBIDDEN');
  });
});
