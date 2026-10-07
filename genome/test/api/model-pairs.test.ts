/**
 * PAIRS WELL WITH in the console (plan NEXT-NINE of 2026-10-06, §3.7 BP-34, step 7.1): PUT /api/admin/models/:id/pairs
 * (OPERATOR, CatalogService.setPairs) and what GET /api/admin/models/:id says of them.
 *
 *  - none, two or three models, in their order; one or four, a model twice: 400; the model itself or one of its
 *    variants: 409 PAIR_SAME_MODEL; on a variant's page: 409 MODEL_IS_VARIANT; an unknown model: 404;
 *  - AUDITOR 403, signed out 401;
 *  - audited model.pairs with the ids before and after; the same picks again write nothing;
 *  - the model's record carries its pairs (each with whether its sheet shows it) and what the sheet shows without them;
 *    a variant's record carries its main model's.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, createHarness, errorOf, safeJson, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

interface Pair {
  position: number;
  id: string;
  name: string;
  label: string | null;
  swatch: string | null;
  lookbook: string;
  slug: string | null;
  shown: string;
}

interface ModelJson {
  id: string;
  pairs: Pair[];
  pairsFallback: { name: string; label: string | null }[];
}

describe('PAIRS WELL WITH in the console (plan NEXT-NINE, BP-34): PUT /api/admin/models/:id/pairs', () => {
  let h: Harness;
  let operator: Client;
  let auditor: Client;
  let admin: Client;
  let catalog: Catalog;
  let main: string;
  let blue: string;
  let a: string;
  let b: string;
  let c: string;
  let d: string;

  const url = (id: string) => `/api/admin/models/${id}/pairs`;
  const put = (id: string, models: unknown, cl: Client = operator) => cl.request('PUT', url(id), { body: { models } });
  const read = async (id: string) => safeJson(await auditor.get(`/api/admin/models/${id}`)) as ModelJson;
  const audits = (id: string) => h.ctx.db.selectFrom('audit_logs').selectAll().where('action', '=', 'model.pairs').where('target_id', '=', id).orderBy('id').execute();

  async function model(name: string, extra: Record<string, unknown> = {}): Promise<string> {
    const created = safeJson(await operator.post('/api/admin/models', { categoryCode: 'J', name, type: 'BRACELET', skuPrefix: `PR-${name.slice(0, 6)}`, collectionId: catalog.collectionId, sizeType: 'BRACELET' })) as { id: string };
    if (Object.keys(extra).length) expect((await operator.patch(`/api/admin/models/${created.id}`, extra)).statusCode).toBe(200);
    return created.id;
  }

  beforeAll(async () => {
    h = await createHarness();
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    admin = await adminClient(h, 'ADMIN');
    catalog = await seedCatalog(h.ctx);
    main = await model('HALO', { lookbook: 'PUBLIC', slug: 'halo' });
    const v = await operator.post(`/api/admin/models/${main}/variants`, { label: 'Blue', swatch: '#16224A', skuPrefix: 'PR-HALOBL', mainLabel: 'Steel', mainSwatch: '#9D9B96' });
    expect(v.statusCode, v.body).toBe(201);
    blue = (safeJson(v) as { id: string }).id;
    a = await model('ZENITH', { lookbook: 'RESERVED', slug: 'zenith' });
    // ORBIT is published a minute after ZENITH: the collection's newest first is ORBIT, then ZENITH.
    h.clock.advance(60_000);
    b = await model('ORBIT', { lookbook: 'PUBLIC', slug: 'orbit' });
    c = await model('NOCTURNE');
    d = await model('ECLIPSE', { lookbook: 'PUBLIC', slug: 'eclipse' });
    expect((await admin.post(`/api/admin/models/${d}/discontinue`, {})).statusCode).toBe(200);
  });
  afterAll(() => h?.close());

  it('saves none, two or three models in their order, audited model.pairs with the ids before and after; the same again writes nothing', async () => {
    const two = await put(main, [b, a]);
    expect(two.statusCode, two.body).toBe(200);
    expect((safeJson(two) as ModelJson).pairs.map((p) => [p.position, p.id])).toEqual([
      [1, b],
      [2, a],
    ]);
    expect((await put(main, [a, b, c])).statusCode).toBe(200);
    expect((await read(main)).pairs.map((p) => p.id)).toEqual([a, b, c]);
    // The same picks again: 200, nothing written, nothing audited.
    const before = (await audits(main)).length;
    expect((await put(main, [a, b, c])).statusCode).toBe(200);
    expect(await audits(main)).toHaveLength(before);
    expect((await put(main, [])).statusCode).toBe(200);
    expect((await read(main)).pairs).toEqual([]);
    const entries = await audits(main);
    expect(entries.map((e) => e.details)).toEqual([
      { before: [], after: [b, a] },
      { before: [b, a], after: [a, b, c] },
      { before: [a, b, c], after: [] },
    ]);
    expect(entries.every((e) => e.target_type === 'model')).toBe(true);
    expect(await h.ctx.db.selectFrom('model_pairs').selectAll().where('model_id', '=', main).execute()).toEqual([]);
  });

  it('refuses one or four models and a model twice (400), the model itself or one of its variants (409), a variant\'s own pairs (409), an unknown model (404)', async () => {
    const one = await put(main, [a]);
    expect([one.statusCode, errorOf(one).code]).toEqual([400, 'VALIDATION_FAILED']);
    const four = await put(main, [a, b, c, d]);
    expect([four.statusCode, errorOf(four).code]).toEqual([400, 'VALIDATION_FAILED']);
    const twice = await put(main, [a, a]);
    expect([twice.statusCode, errorOf(twice).code]).toEqual([400, 'VALIDATION_FAILED']);
    expect(errorOf(twice).message).toBe('Each model is picked once.');
    for (const same of [[main, a], [a, blue]]) {
      const r = await put(main, same);
      expect([r.statusCode, errorOf(r).code, errorOf(r).message]).toEqual([409, 'PAIR_SAME_MODEL', 'A model pairs with another model, not with itself or one of its variants.']);
    }
    const onVariant = await put(blue, [a, b]);
    expect([onVariant.statusCode, errorOf(onVariant).code]).toEqual([409, 'MODEL_IS_VARIANT']);
    expect(errorOf(onVariant).message).toBe('A variant’s pairs are set on its main model: its sheet is the same.');
    const unknownPick = await put(main, [a, '00000000-0000-4000-8000-000000000000']);
    expect([unknownPick.statusCode, errorOf(unknownPick).code]).toEqual([404, 'MODEL_NOT_FOUND']);
    const unknownModel = await put('00000000-0000-4000-8000-000000000000', [a, b]);
    expect([unknownModel.statusCode, errorOf(unknownModel).code]).toEqual([404, 'MODEL_NOT_FOUND']);
    const malformed = await put(main, ['not-a-model', b]);
    expect([malformed.statusCode, errorOf(malformed).code]).toEqual([400, 'VALIDATION_FAILED']);
    expect((await h.client().request('PUT', url(main), { body: { models: [] } })).statusCode).toBe(401);
    expect(errorOf(await put(main, [a, b], auditor)).code).toBe('FORBIDDEN');
    expect((await put(main, [a, b], auditor)).statusCode).toBe(403);
    // Nothing was written by any refusal.
    expect((await read(main)).pairs).toEqual([]);
  });

  it('reads each pair with whether the sheet shows it, what the sheet shows without them, and a variant\'s as its main model\'s', async () => {
    expect((await put(main, [a, b, d])).statusCode).toBe(200);
    const m = await read(main);
    expect(m.pairs.map((p) => [p.name, p.lookbook, p.slug, p.shown])).toEqual([
      ['ZENITH', 'RESERVED', 'zenith', 'SALON'],
      ['ORBIT', 'PUBLIC', 'orbit', 'EVERYONE'],
      ['ECLIPSE', 'PUBLIC', 'eclipse', 'DISCONTINUED'],
    ]);
    expect(Object.keys(m.pairs[0]!).sort()).toEqual(['id', 'label', 'lookbook', 'name', 'position', 'shown', 'slug', 'swatch']);
    // Without picks, the sheet would show the other models of the collection as an owner reads them, the newest first:
    // ORBIT, then ZENITH (NOCTURNE is hidden, ECLIPSE discontinued, MONOLITHE has no address), never the picks' order
    // (ZENITH, then ORBIT) although two picks show.
    const fallback = [
      { name: 'ORBIT', label: null },
      { name: 'ZENITH', label: null },
    ];
    expect(m.pairsFallback).toEqual(fallback);
    // A variant's record carries its main model's pairs, and the same fallback.
    expect((await read(blue)).pairs.map((p) => p.id)).toEqual([a, b, d]);
    expect((await read(blue)).pairsFallback).toEqual(fallback);
    // Without picks, the fallback is the same.
    expect((await put(main, [])).statusCode).toBe(200);
    expect((await read(main)).pairsFallback).toEqual(fallback);
    // A hidden pick reads Not shown.
    expect((await put(main, [c, b])).statusCode).toBe(200);
    expect((await read(main)).pairs.map((p) => p.shown)).toEqual(['HIDDEN', 'EVERYONE']);
    expect((await put(main, [])).statusCode).toBe(200);
  });
});
