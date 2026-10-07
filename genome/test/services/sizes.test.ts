/**
 * YOUR SIZES (plan NEXT-NINE of 2026-10-06, §3.4 AC-01, step 4.1; migration 0030), on the services and the routes as
 * createContext and buildApp wire them:
 *
 *  - an account's sizes saved, read and cleared, in the collector's units (a ring size, centimetres), saved whole;
 *  - a value off its kind's range or step refused (400), with the kind's words ('A ring size is 40 to 76.');
 *  - the audit holds the kinds set and cleared, never the measures; nothing changed, nothing audited;
 *  - a label read as a measure (`labelToMm`): '52', 'SIZE 52', '52 MM', '17.5 CM', '17,5 cm', '45', '39 MM', ONE SIZE;
 *  - the matching (`matchSavedSize`): a fit range wins over the label, two matches give none, no kind gives none, a size
 *    without stock is never preselected, and a variant reads its main model's size kind;
 *  - a model's Sizes in the console: its kind, what a variant reads, its sizes' fits; a SKU of another model 404;
 *  - the account's routes: 401 signed out, the CSRF token and the same origin on the write, 400 off range.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { labelToMm, matchSavedSize, sizeKindOf, type SizeCandidate } from '../../src/server/services/sizes.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { SYSTEM_ACTOR, type Actor } from '../../src/server/types.js';
import { accountClient, adminClient, createHarness, errorOf, safeJson, seedCatalog, type Catalog, type Client, type Harness } from '../api/support.js';

describe('YOUR SIZES (AC-01)', () => {
  let h: Harness;
  let catalog: Catalog;
  let operator: Client;
  let auditor: Client;
  let admin: Actor;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-07T09:00:00.000Z');
    catalog = await seedCatalog(h.ctx);
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    const a = await h.t.db.selectFrom('admin_users').select('id').where('role', '=', 'OPERATOR').executeTakeFirstOrThrow();
    admin = { type: 'admin', id: a.id };
  });
  afterAll(() => h?.close());

  async function collector() {
    const { client, email } = await accountClient(h);
    const id = (await h.t.db.selectFrom('accounts').select('id').where('email_normalized', '=', email).executeTakeFirstOrThrow()).id;
    return { client, id, actor: { type: 'account', id } as Actor };
  }
  const put = (c: Client, sizes: unknown, opts: { noCsrf?: boolean; origin?: string | null } = {}) => c.request('PUT', '/api/v1/account/sizes', { body: { sizes }, ...opts });
  const audits = async (accountId: string) => (await h.ctx.audit.list({ action: 'account.sizes.update', targetId: accountId })).items;

  it('saves, reads and clears the sizes whole, in the collector\'s units', async () => {
    const c = await collector();
    const sizes = h.ctx.services.sizes;
    expect(await sizes.get(c.id)).toEqual({ RING: null, BRACELET: null, WRIST: null, NECKLACE: null });
    expect(await sizes.set(c.id, { RING: 52, WRIST: 16.5 }, c.actor)).toEqual({ RING: 52, BRACELET: null, WRIST: 16.5, NECKLACE: null });
    // Stored in whole millimetres: the ring size itself, the centimetres × 10.
    const rows = await h.t.db.selectFrom('account_sizes').select(['kind', 'value_mm']).where('account_id', '=', c.id).orderBy('kind').execute();
    expect(rows).toEqual([
      { kind: 'RING', value_mm: 52 },
      { kind: 'WRIST', value_mm: 165 },
    ]);
    // Saved whole: a kind left out or null is cleared (its row deleted), another set.
    expect(await sizes.set(c.id, { RING: 54, BRACELET: 18, NECKLACE: null }, c.actor)).toEqual({ RING: 54, BRACELET: 18, WRIST: null, NECKLACE: null });
    expect(await sizes.set(c.id, {}, c.actor)).toEqual({ RING: null, BRACELET: null, WRIST: null, NECKLACE: null });
    expect(await h.t.db.selectFrom('account_sizes').select('kind').where('account_id', '=', c.id).execute()).toEqual([]);
    // Each bound and step of the units: a ring 40 to 76; a bracelet and a wrist by 0.5 cm; a necklace by 1 cm.
    expect(await sizes.set(c.id, { RING: 40, BRACELET: 24, WRIST: 12, NECKLACE: 100 }, c.actor)).toEqual({ RING: 40, BRACELET: 24, WRIST: 12, NECKLACE: 100 });
    expect(await sizes.set(c.id, { RING: 76, BRACELET: 14.5, WRIST: 23.5, NECKLACE: 35 }, c.actor)).toEqual({ RING: 76, BRACELET: 14.5, WRIST: 23.5, NECKLACE: 35 });
  });

  it('refuses a value off its range or step with the kind\'s words, and changes nothing', async () => {
    const c = await collector();
    const sizes = h.ctx.services.sizes;
    await sizes.set(c.id, { RING: 52 }, c.actor);
    const refused = async (input: unknown, message: string) => {
      await expect(sizes.set(c.id, input, c.actor), JSON.stringify(input)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', httpStatus: 400, publicMessage: message });
    };
    await refused({ RING: 39 }, 'A ring size is 40 to 76.');
    await refused({ RING: 77 }, 'A ring size is 40 to 76.');
    await refused({ RING: 52.5 }, 'A ring size is 40 to 76.');
    await refused({ BRACELET: 13.5 }, 'A bracelet size is 14 to 24 cm, by 0.5 cm.');
    await refused({ BRACELET: 17.2 }, 'A bracelet size is 14 to 24 cm, by 0.5 cm.');
    await refused({ WRIST: 24.5 }, 'A wrist is 12 to 24 cm, by 0.5 cm.');
    await refused({ WRIST: 14.7 }, 'A wrist is 12 to 24 cm, by 0.5 cm.');
    await refused({ NECKLACE: 35.5 }, 'A necklace length is 35 to 100 cm, by 1 cm.');
    await refused({ NECKLACE: 101 }, 'A necklace length is 35 to 100 cm, by 1 cm.');
    await refused({ RING: '52' }, 'A ring size is 40 to 76.');
    await refused({ ANKLE: 20 }, 'Your sizes are a ring size, a bracelet size, a wrist and a necklace length.');
    expect(await sizes.get(c.id)).toEqual({ RING: 52, BRACELET: null, WRIST: null, NECKLACE: null });
  });

  it('audits the kinds set and cleared, never the measures; nothing changed, nothing audited', async () => {
    const c = await collector();
    const sizes = h.ctx.services.sizes;
    await sizes.set(c.id, { RING: 52, WRIST: 16.5 }, c.actor);
    await sizes.set(c.id, { RING: 52, WRIST: 16.5 }, c.actor);
    await sizes.set(c.id, { RING: 53 }, c.actor);
    // The newest first.
    const entries = (await audits(c.id)).reverse();
    expect(entries.map((e) => e.details)).toEqual([
      { set: ['RING', 'WRIST'], cleared: [] },
      { set: ['RING'], cleared: ['WRIST'] },
    ]);
    expect(entries.every((e) => e.actorType === 'account' && e.targetType === 'account')).toBe(true);
    expect(JSON.stringify(entries)).not.toMatch(/\b(52|53|16\.5|165)\b/);
  });

  it('reads a size\'s label as a measure of its kind', () => {
    expect(labelToMm('RING', '52')).toBe(52);
    expect(labelToMm('RING', 'SIZE 52')).toBe(52);
    expect(labelToMm('RING', 'size 52')).toBe(52);
    expect(labelToMm('RING', '52 MM')).toBe(52);
    expect(labelToMm('BRACELET', '17.5 CM')).toBe(175);
    expect(labelToMm('BRACELET', '17,5 cm')).toBe(175);
    // A number without a unit: a ring's French size, centimetres otherwise.
    expect(labelToMm('NECKLACE', '45')).toBe(450);
    expect(labelToMm('WRIST', '17')).toBe(170);
    expect(labelToMm('WRIST', '39 MM')).toBe(39);
    for (const label of ['ONE SIZE', 'S', 'M / L', '', '52 INCHES', null]) expect(labelToMm('RING', label), String(label)).toBeNull();
  });

  it('preselects only exactly one match: a fit range wins, two matches or none give none, no kind gives none, a size without stock never', () => {
    const size = (id: string, label: string, fit: [number, number] | null = null, stock?: number): SizeCandidate => ({
      id,
      label,
      fitMinMm: fit?.[0] ?? null,
      fitMaxMm: fit?.[1] ?? null,
      ...(stock !== undefined ? { stock } : {}),
    });
    const rings = [size('a', '50'), size('b', '52'), size('c', '54')];
    expect(matchSavedSize('RING', 52, rings)?.id).toBe('b');
    expect(matchSavedSize('RING', 53, rings)).toBeNull();
    // A fit range wins over the label: S fits 16 to 17.5 cm, M (label 17) 17.5 to 19.
    const bracelets = [size('s', 'S', [160, 175]), size('m', '17', [176, 190])];
    expect(matchSavedSize('BRACELET', 170, bracelets)?.id).toBe('s');
    expect(matchSavedSize('BRACELET', 180, bracelets)?.id).toBe('m');
    // Two matches give none.
    expect(matchSavedSize('BRACELET', 175, [size('s', 'S', [160, 175]), size('m', 'M', [175, 190])])).toBeNull();
    expect(matchSavedSize('RING', 52, [size('a', '52'), size('b', 'SIZE 52')])).toBeNull();
    // No kind, or no saved size, gives none.
    expect(matchSavedSize(null, 52, rings)).toBeNull();
    expect(matchSavedSize('RING', null, rings)).toBeNull();
    // A size counted without stock is never preselected; one not counted (a salon's) is.
    expect(matchSavedSize('RING', 52, [size('a', '50', null, 2), size('b', '52', null, 0)])).toBeNull();
    expect(matchSavedSize('RING', 52, [size('a', '50', null, 2), size('b', '52', null, 1)])?.id).toBe('b');
    // '39 MM' is no wrist the house measures: nothing is preselected.
    expect(matchSavedSize('WRIST', 165, [size('x', '39 MM'), size('y', 'ONE SIZE')])).toBeNull();
  });

  it('reads a model\'s size kind, and a variant\'s from its main model unless it has its own; a SKU\'s fit matches through the service', async () => {
    const sizes = h.ctx.services.sizes;
    const variant = await h.ctx.services.catalog.createVariant(catalog.modelId, { label: 'Gold', swatch: '#B88A3A', skuPrefix: 'SIZ-GD', mainLabel: 'Steel', mainSwatch: '#9D9B96' }, SYSTEM_ACTOR);
    expect(await sizeKindOf(h.t.db, catalog.modelId)).toBeNull();
    const [s50, s52] = await Promise.all([ensureSku(h.t.db, variant.id, '50'), ensureSku(h.t.db, variant.id, '52')]);
    await sizes.setModelSizes(catalog.modelId, { sizeKind: 'RING' }, admin);
    expect(await sizeKindOf(h.t.db, catalog.modelId)).toBe('RING');
    expect(await sizeKindOf(h.t.db, variant.id)).toBe('RING');
    const c = await collector();
    await sizes.set(c.id, { RING: 52, BRACELET: 18 }, c.actor);
    const candidates = (await h.t.db.selectFrom('skus').select(['id', 'size_label']).where('model_id', '=', variant.id).execute()).map((r) => ({ id: r.id, label: r.size_label!, fitMinMm: null, fitMaxMm: null }));
    expect((await sizes.savedSizeFor(c.id, variant.id, candidates))?.id).toBe(s52);
    // The variant's own kind wins over its main model's.
    await sizes.setModelSizes(variant.id, { sizeKind: 'BRACELET' }, admin);
    expect(await sizeKindOf(h.t.db, variant.id)).toBe('BRACELET');
    expect(await sizes.savedSizeFor(c.id, variant.id, candidates)).toBeNull();
    // A fit set on 50 for 17.5 to 18.5 cm: the saved bracelet of 18 cm preselects it.
    await sizes.setModelSizes(variant.id, { fits: [{ skuId: s50, fitMinMm: 175, fitMaxMm: 185 }] }, admin);
    const fitted = (await h.t.db.selectFrom('skus').select(['id', 'size_label', 'fit_min_mm', 'fit_max_mm']).where('model_id', '=', variant.id).execute()).map((r) => ({
      id: r.id,
      label: r.size_label!,
      fitMinMm: r.fit_min_mm,
      fitMaxMm: r.fit_max_mm,
    }));
    expect((await sizes.savedSizeFor(c.id, variant.id, fitted))?.id).toBe(s50);
    // Nothing was written by reading.
    expect((await audits(c.id)).length).toBe(1);
    await sizes.setModelSizes(variant.id, { sizeKind: null, fits: [{ skuId: s50, fitMinMm: null, fitMaxMm: null }] }, admin);
  });

  it('gives the console a model\'s Sizes and saves its kind and fits (OPERATOR), refusing a SKU of another model; audited model.sizes.update', async () => {
    const other = await seedCatalog(h.ctx);
    const sku52 = await ensureSku(h.t.db, other.modelId, '52');
    const sku54 = await ensureSku(h.t.db, other.modelId, '54');
    await ensureSku(h.t.db, other.modelId, null);
    const foreign = await ensureSku(h.t.db, catalog.modelId, '60');
    const read = async (c: Client) => safeJson(await c.get(`/api/admin/models/${other.modelId}/sizes`)) as any;
    const before = await read(auditor);
    expect(before).toEqual({
      modelId: other.modelId,
      sizeKind: null,
      inherited: null,
      sizes: [
        { skuId: sku52, label: '52', code: expect.any(String), fitMinMm: null, fitMaxMm: null },
        { skuId: sku54, label: '54', code: expect.any(String), fitMinMm: null, fitMaxMm: null },
      ],
    });
    const save = (body: unknown) => operator.request('PUT', `/api/admin/models/${other.modelId}/sizes`, { body });
    let res = await save({ sizeKind: 'RING', fits: [{ skuId: sku54, fitMinMm: 53, fitMaxMm: 55 }] });
    expect(res.statusCode).toBe(200);
    expect((safeJson(res) as any).sizes[1]).toMatchObject({ skuId: sku54, fitMinMm: 53, fitMaxMm: 55 });
    expect((safeJson(res) as any).sizeKind).toBe('RING');
    res = await save({ fits: [{ skuId: foreign, fitMinMm: 60, fitMaxMm: 60 }] });
    expect(res.statusCode).toBe(404);
    expect(errorOf(res).code).toBe('SKU_NOT_FOUND');
    for (const [body, message] of [
      [{ fits: [{ skuId: sku52, fitMinMm: 53, fitMaxMm: null }] }, 'Give Fits from and Fits to, or neither.'],
      [{ fits: [{ skuId: sku52, fitMinMm: 55, fitMaxMm: 53 }] }, 'Fits from is at most Fits to.'],
    ] as const) {
      res = await save(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(errorOf(res).message).toBe(message);
    }
    expect((await save({ fits: [{ skuId: sku52, fitMinMm: 0, fitMaxMm: 52 }] })).statusCode).toBe(400);
    expect((await save({ sizeKind: 'ANKLE' })).statusCode).toBe(400);
    expect((await save({})).statusCode).toBe(400);
    expect((await auditor.request('PUT', `/api/admin/models/${other.modelId}/sizes`, { body: { sizeKind: null } })).statusCode).toBe(403);
    const entries = (await h.ctx.audit.list({ action: 'model.sizes.update', targetId: other.modelId })).items;
    expect(entries.map((e) => e.details)).toEqual([{ sizeKind: { before: null, after: 'RING' }, skus: [sku54] }]);
    // A variant without a kind of its own reads its main model's, named.
    const variant = await h.ctx.services.catalog.createVariant(other.modelId, { label: 'Night', swatch: '#16224A', skuPrefix: 'SIZ-NT', mainLabel: 'Day', mainSwatch: '#9D9B96' }, SYSTEM_ACTOR);
    expect(await read(auditor).then(() => auditor.get(`/api/admin/models/${variant.id}/sizes`)).then((r) => safeJson(r))).toMatchObject({
      sizeKind: null,
      inherited: { sizeKind: 'RING', from: 'MONOLITHE' },
      sizes: [],
    });
  });

  it('serves the account\'s routes signed in only, the write with its CSRF token and same origin, 400 off range', async () => {
    const anon = h.client();
    expect((await anon.get('/api/v1/account/sizes')).statusCode).toBe(401);
    expect((await put(anon, { RING: 52 })).statusCode).toBe(401);
    const c = await collector();
    expect(safeJson(await c.client.get('/api/v1/account/sizes'))).toEqual({ sizes: { RING: null, BRACELET: null, WRIST: null, NECKLACE: null } });
    expect(errorOf(await put(c.client, { RING: 52 }, { noCsrf: true })).code).toBe('CSRF_FAILED');
    expect(errorOf(await put(c.client, { RING: 52 }, { origin: 'https://elsewhere.example' })).code).toBe('CSRF_FAILED');
    let res = await put(c.client, { RING: 39 });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res)).toEqual({ code: 'VALIDATION_FAILED', message: 'A ring size is 40 to 76.' });
    expect((await put(c.client, { RING: 52, ANKLE: 20 })).statusCode).toBe(400);
    expect((await c.client.request('PUT', '/api/v1/account/sizes', { body: { RING: 52 } })).statusCode).toBe(400);
    res = await put(c.client, { RING: 52, WRIST: 16.5, NECKLACE: null });
    expect(res.statusCode).toBe(200);
    expect(safeJson(res)).toEqual({ sizes: { RING: 52, BRACELET: null, WRIST: 16.5, NECKLACE: null } });
    expect(safeJson(await c.client.get('/api/v1/account/sizes'))).toEqual({ sizes: { RING: 52, BRACELET: null, WRIST: 16.5, NECKLACE: null } });
  });
});
