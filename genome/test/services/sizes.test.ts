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
 *
 * DECLARED SIZES (plan NEXT LOT of 2026-10-07, §3.3, step 3.2; migration 0033): the type's lists and how a label reads
 * on them; a size type given (its kind derived), sizes ticked (created, reused by their measure, reinstated), unticked
 * (removed when unused, set aside when a movement, an order, a piece, a release, a minimum, a Shopify id or an open salon
 * request uses it), one removed or reinstated, the last offered one kept, the audit `model.sizes.declare`; `offeredSku`
 * as every flow names a size; next-nine's size kind kept for a model with no type; the exchange's sizes; and, on PGlite
 * and (opt-in) PostgreSQL, a removal racing a release or an order on the same size: set aside or SIZE_NOT_DECLARED,
 * never a foreign-key failure nor a deadlock.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { closeDb, createDb, inTransaction, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import type { SizeType } from '../../src/server/db/schema.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import {
  declaredSizes,
  labelToMm,
  listEntryOf,
  matchSavedSize,
  modelSizeCandidates,
  offeredSizes,
  offeredSku,
  SIZE_TYPE_KIND,
  sizeKindOf,
  SKU_USES,
  skuUsed,
  sizesForExchange,
  standardSizes,
  type SizeCandidate,
} from '../../src/server/services/sizes.js';
import { defaultLocationId, ensureSku } from '../../src/server/services/stock.js';
import { createManualClock, SYSTEM_ACTOR, type Actor } from '../../src/server/types.js';
import { createTestDb } from '../support/db.js';
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
    // Plan NEXT LOT §3.3: every declared size, ONE SIZE included, with where it stands; no size type yet ('To give').
    const row = (skuId: string, label: string | null) => ({ skuId, label, code: expect.any(String), fitMinMm: null, fitMaxMm: null, setAsideAt: null, onList: true, sameAs: null, used: false, awaiting: 0 });
    expect(before).toEqual({
      modelId: other.modelId,
      sizeType: null,
      sizeKind: null,
      inherited: null,
      list: [],
      sizes: [row(expect.any(String), null), row(sku52, '52'), row(sku54, '54')],
      offered: 3,
      setAside: 0,
    });
    const save = (body: unknown) => operator.request('PUT', `/api/admin/models/${other.modelId}/sizes`, { body });
    let res = await save({ sizeKind: 'RING', fits: [{ skuId: sku54, fitMinMm: 53, fitMaxMm: 55 }] });
    expect(res.statusCode).toBe(200);
    expect((safeJson(res) as any).sizes[2]).toMatchObject({ skuId: sku54, fitMinMm: 53, fitMaxMm: 55 });
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
    // Plan NEXT LOT §3.3: made by a fixture without a type, it has none either, and its main model's offered sizes are
    // copied as they are, each its own SKU under its prefix.
    const read2 = (await read(auditor).then(() => auditor.get(`/api/admin/models/${variant.id}/sizes`)).then((r) => safeJson(r))) as any;
    expect(read2).toMatchObject({ sizeType: null, sizeKind: null, inherited: { sizeKind: 'RING', from: 'MONOLITHE' } });
    expect(read2.sizes.map((z: any) => [z.label, z.code])).toEqual([[null, 'SIZ-NT'], ['52', 'SIZ-NT-52'], ['54', 'SIZ-NT-54']]);
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

describe('DECLARED SIZES (NEXT LOT §3.3)', () => {
  let h: Harness;
  let admin: Actor;
  let operator: Client;
  let auditor: Client;
  let n = 0;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-07T09:00:00.000Z');
    await seedCatalog(h.ctx);
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    const a = await h.t.db.selectFrom('admin_users').select('id').where('role', '=', 'OPERATOR').executeTakeFirstOrThrow();
    admin = { type: 'admin', id: a.id };
  });
  afterAll(() => h?.close());

  /** A model of the catalogue: `prefix` its SKU prefix; typed at creation, or none (a model of before H1). */
  async function model(prefix: string, sizeType?: SizeType, type = 'SIGNET RING'): Promise<string> {
    n++;
    return (await h.ctx.services.catalog.createModel({ categoryCode: 'J', name: `MODEL ${n}`, type, skuPrefix: prefix, ...(sizeType ? { sizeType } : {}) }, SYSTEM_ACTOR)).id;
  }
  const codes = async (modelId: string) =>
    (await h.t.db.selectFrom('skus').select(['code', 'size_label', 'set_aside_at', 'set_aside_by']).where('model_id', '=', modelId).orderBy('code').execute()).map((r) => ({
      code: r.code,
      label: r.size_label,
      offered: r.set_aside_at === null,
      by: r.set_aside_by,
    }));
  const declares = async (modelId: string) => (await h.ctx.audit.list({ action: 'model.sizes.declare', targetId: modelId })).items.map((e) => e.details);
  const refusal = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      if (e instanceof DomainError) return { code: e.code, status: e.httpStatus, message: e.publicMessage };
      throw e;
    }
    throw new Error('expected a refusal');
  };
  const sizes = () => h.ctx.services.sizes;

  it('lists each type\'s sizes, fixed, each the bare number; a watch and a model of one size none', () => {
    const ring = standardSizes('RING');
    expect([ring.length, ring[0], ring.at(-1)]).toEqual([37, '40', '76']);
    const bracelet = standardSizes('BRACELET');
    expect([bracelet.length, bracelet[0], bracelet[1], bracelet.at(-1)]).toEqual([21, '14', '14.5', '24']);
    const necklace = standardSizes('NECKLACE');
    expect([necklace.length, necklace[0], necklace.at(-1)]).toEqual([66, '35', '100']);
    expect(standardSizes('WATCH')).toEqual([]);
    expect(standardSizes('ONE_SIZE')).toEqual([]);
    expect(standardSizes(null)).toEqual([]);
    expect(SIZE_TYPE_KIND).toEqual({ RING: 'RING', BRACELET: 'BRACELET', NECKLACE: 'NECKLACE', WATCH: 'WRIST', ONE_SIZE: null });
  });

  it('reads a label as its type\'s list reads it, by its measure', () => {
    expect(listEntryOf('RING', 'SIZE 52')).toBe('52');
    expect(listEntryOf('RING', '52 MM')).toBe('52');
    expect(listEntryOf('RING', '52')).toBe('52');
    expect(listEntryOf('BRACELET', '17,5 cm')).toBe('17.5');
    expect(listEntryOf('BRACELET', '17.5')).toBe('17.5');
    expect(listEntryOf('NECKLACE', '45')).toBe('45');
    expect(listEntryOf('RING', 'S')).toBeNull();
    expect(listEntryOf('RING', 'ONE SIZE')).toBeNull();
    expect(listEntryOf('RING', null)).toBeNull();
    expect(listEntryOf('RING', '39')).toBeNull();
    expect(listEntryOf('BRACELET', '17.2')).toBeNull();
    expect(listEntryOf('WATCH', '52')).toBeNull();
    expect(listEntryOf(null, '52')).toBeNull();
  });

  it('gives a model its type (the kind derived) and ticks its sizes: each created with its SKU, an existing SIZE 52 reused for 52, a set-aside one reinstated, an unticked unused one removed', async () => {
    const ring = await model('MNL-RG');
    await ensureSku(h.t.db, ring, 'SIZE 52');
    let s = await sizes().declare(ring, { sizeType: 'RING' }, admin);
    expect(s).toMatchObject({ sizeType: 'RING', sizeKind: 'RING', inherited: null, offered: 1, setAside: 0 });
    expect(s.list).toEqual(standardSizes('RING'));
    // Off-list or not, the type never removes a size: SIZE 52 stays offered, read as 52.
    expect(s.sizes).toEqual([expect.objectContaining({ label: 'SIZE 52', onList: true, sameAs: null, used: false, awaiting: 0, setAsideAt: null })]);
    s = await sizes().declare(ring, { ticked: ['50', '52', '54'] }, admin);
    // 52 is SIZE 52 by its measure: no second SKU.
    expect(await codes(ring)).toEqual([
      { code: 'MNL-RG-50', label: '50', offered: true, by: null },
      { code: 'MNL-RG-54', label: '54', offered: true, by: null },
      { code: 'MNL-RG-SIZE-52', label: 'SIZE 52', offered: true, by: null },
    ]);
    // In compareSizes' order (a label with letters after the numbers).
    expect(s.sizes.map((z) => z.label)).toEqual(['50', '54', 'SIZE 52']);
    // A bracelet's half size: its code as deriveSku writes it.
    const bracelet = await model('MNL-BR', 'BRACELET', 'CUFF');
    await sizes().declare(bracelet, { ticked: ['17.5', '18'] }, admin);
    expect((await codes(bracelet)).map((c) => c.code)).toEqual(['MNL-BR-17-5', 'MNL-BR-18']);
    // Unticked and unused: removed, its SKU deleted.
    await sizes().declare(ring, { ticked: ['52', '54'] }, admin);
    expect((await codes(ring)).map((c) => c.code)).toEqual(['MNL-RG-54', 'MNL-RG-SIZE-52']);
    // Set aside (used), then ticked again: reinstated, no second SKU.
    await h.t.db.updateTable('skus').set({ shopify_variant_id: '9001' }).where('code', '=', 'MNL-RG-54').execute();
    await sizes().declare(ring, { ticked: ['52'] }, admin);
    expect(await codes(ring)).toEqual([
      { code: 'MNL-RG-54', label: '54', offered: false, by: admin.id },
      { code: 'MNL-RG-SIZE-52', label: 'SIZE 52', offered: true, by: null },
    ]);
    await sizes().declare(ring, { ticked: ['52', '54'] }, admin);
    expect(await codes(ring)).toEqual([
      { code: 'MNL-RG-54', label: '54', offered: true, by: null },
      { code: 'MNL-RG-SIZE-52', label: 'SIZE 52', offered: true, by: null },
    ]);
    // Each declaration audited by its SKU codes; nothing changed, nothing written.
    expect(await declares(ring)).toEqual([
      { added: [], reinstated: ['MNL-RG-54'], setAside: [], removed: [] },
      { added: [], reinstated: [], setAside: ['MNL-RG-54'], removed: [] },
      { added: [], reinstated: [], setAside: [], removed: ['MNL-RG-50'] },
      { added: ['MNL-RG-50', 'MNL-RG-54'], reinstated: [], setAside: [], removed: [] },
      { sizeType: { before: null, after: 'RING' }, added: [], reinstated: [], setAside: [], removed: [] },
    ]);
    expect(await refusal(sizes().declare(ring, { ticked: ['52', '54'] }, admin))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'Nothing has changed.' });
    expect(await refusal(sizes().declare(ring, { sizeType: 'RING' }, admin))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'Nothing has changed.' });
    expect(await declares(ring)).toHaveLength(5);
  });

  it('sets an unticked size aside when anything uses it: a movement, an order, a piece, a release, a minimum, a Shopify id, an open salon request', async () => {
    const ring = await model('USE-RG', 'RING');
    const labels = ['50', '51', '52', '53', '54', '55', '56', '57'];
    await sizes().declare(ring, { ticked: labels }, admin);
    const sku = async (label: string) => (await h.t.db.selectFrom('skus').select('id').where('model_id', '=', ring).where('size_label', '=', label).executeTakeFirstOrThrow()).id;
    const location = await defaultLocationId(h.t.db);
    const account = (await h.t.db.insertInto('accounts').values({ email: 'uses@example.com', email_normalized: 'uses@example.com', password_hash: 'scrypt$x' }).returning('id').executeTakeFirstOrThrow()).id;
    // 50: a stock movement.
    await h.ctx.services.stock.adjust({ skuId: await sku('50'), locationId: location, delta: 1, note: 'Counted.' }, admin);
    // 51: an order (a salon's).
    const closed = await h.t.db.insertInto('shop_requests').values({ account_id: account, model_id: ring, status: 'CLOSED', created_at: h.clock.now(), handled_at: h.clock.now(), outcome: 'ACCEPTED' }).returning('id').executeTakeFirstOrThrow();
    await h.t.db.insertInto('orders').values({ channel: 'SALON', shop_request_id: closed.id, account_id: account, model_id: ring, size_label: '51', sku_id: await sku('51'), location_id: location }).execute();
    // 52: a piece.
    await h.ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: ring, material: '925 STERLING SILVER', variant: '52' }, SYSTEM_ACTOR);
    // 53: a release's size.
    const drop = await h.ctx.services.drops.create({ modelId: ring, title: 'DRAW', quantity: 1, opensAt: new Date('2026-11-01T09:00:00Z'), closesAt: new Date('2026-11-02T09:00:00Z'), earlyAccessHours: 0 }, admin);
    await h.t.db.insertInto('drop_sizes').values({ drop_id: drop.id, label: '53', position: 1, stock: 1, sku_id: await sku('53') }).execute();
    // 54: a minimum; 55: a Shopify id; 56: an open salon request in that size.
    await h.t.db.insertInto('sku_thresholds').values({ sku_id: await sku('54'), location_id: location, minimum: 2 }).execute();
    await h.t.db.updateTable('skus').set({ shopify_product_id: '7001' }).where('id', '=', await sku('55')).execute();
    await h.t.db.insertInto('shop_requests').values({ account_id: account, model_id: ring, size_label: '56' }).execute();
    for (const l of labels) expect(await skuUsed(h.t.db, await sku(l)), l).toBe(l !== '57');
    expect((await declaredSizes(h.t.db, ring)).map((z) => [z.label, z.used])).toEqual(labels.map((l) => [l, l !== '57']));
    await sizes().declare(ring, { ticked: ['40'] }, admin);
    const after = await codes(ring);
    expect(after.filter((c) => c.offered).map((c) => c.label)).toEqual(['40']);
    expect(after.filter((c) => !c.offered).map((c) => c.label)).toEqual(['50', '51', '52', '53', '54', '55', '56']);
    expect(after.find((c) => c.label === '57')).toBeUndefined();
    // Taken in the order of their ids (the locks'), audited by their codes.
    const last = (await declares(ring))[0] as { setAside: string[] };
    expect({ ...last, setAside: [...last.setAside].sort() }).toEqual({
      added: ['USE-RG-40'],
      reinstated: [],
      setAside: ['USE-RG-50', 'USE-RG-51', 'USE-RG-52', 'USE-RG-53', 'USE-RG-54', 'USE-RG-55', 'USE-RG-56'],
      removed: ['USE-RG-57'],
    });
    // The offered reads leave them out; the console's section counts them.
    expect((await offeredSizes(h.t.db, ring)).map((o) => o.label)).toEqual(['40']);
    expect((await modelSizeCandidates(h.t.db, ring, { offered: true })).map((c) => c.label)).toEqual(['40']);
    expect((await modelSizeCandidates(h.t.db, ring)).map((c) => c.label)).toHaveLength(8);
    const section = await sizes().modelSizes(ring);
    expect([section.offered, section.setAside]).toEqual([1, 7]);
    expect(section.sizes.map((z) => z.label)).toEqual(['40', '50', '51', '52', '53', '54', '55', '56']);
    expect(section.sizes[1]!.setAsideAt).toEqual(h.clock.now());
  });

  it('keeps at least one size offered, never removes a size by giving or changing the type, and declares ONE SIZE for a watch or a model of one size', async () => {
    const ring = await model('LST-RG', 'RING');
    expect(await refusal(sizes().declare(ring, { ticked: [] }, admin))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'Leave at least one size offered.' });
    await sizes().declare(ring, { ticked: ['52'] }, admin);
    expect(await refusal(sizes().declare(ring, { ticked: [] }, admin))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'Leave at least one size offered.' });
    expect(await refusal(sizes().declare(ring, { ticked: ['39'] }, admin))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'Size 39 is not on the Ring size list.' });
    // A type changed keeps the sizes, flagged off the new list.
    let s = await sizes().declare(ring, { sizeType: 'BRACELET' }, admin);
    expect(s).toMatchObject({ sizeType: 'BRACELET', sizeKind: 'BRACELET', offered: 1 });
    expect(s.sizes).toEqual([expect.objectContaining({ label: '52', onList: false })]);
    // The off-list size counts as offered: ticking only 17 keeps 52 and adds 17.
    await sizes().declare(ring, { ticked: ['17'] }, admin);
    expect((await codes(ring)).map((c) => [c.label, c.offered])).toEqual([['17', true], ['52', true]]);
    // A watch: ONE SIZE at once, the others kept and flagged; its kind the wrist; no list to tick.
    s = await sizes().declare(ring, { sizeType: 'WATCH' }, admin);
    expect(s).toMatchObject({ sizeType: 'WATCH', sizeKind: 'WRIST', list: [], offered: 3 });
    expect(s.sizes.map((z) => [z.label, z.onList])).toEqual([[null, true], ['17', false], ['52', false]]);
    expect(await refusal(sizes().declare(ring, { ticked: ['52'] }, admin))).toEqual({ code: 'SIZE_TYPE_REQUIRED', status: 409, message: 'Give the model its size type first.' });
    // A model of one size: its kind none; ONE SIZE kept.
    s = await sizes().declare(ring, { sizeType: 'ONE_SIZE' }, admin);
    expect(s).toMatchObject({ sizeType: 'ONE_SIZE', sizeKind: null, offered: 3 });
    // Created as a watch or one size: ONE SIZE declared at once, its SKU the prefix alone.
    const watch = await model('WCH-AU', 'WATCH', 'AUTOMATIC WATCH');
    expect(await codes(watch)).toEqual([{ code: 'WCH-AU', label: null, offered: true, by: null }]);
    expect((await h.t.db.selectFrom('models').select(['size_type', 'size_kind']).where('id', '=', watch).executeTakeFirstOrThrow())).toEqual({ size_type: 'WATCH', size_kind: 'WRIST' });
    // Removing the last offered size is refused; a size of no type cannot be ticked.
    const one = (await codes(watch))[0]!;
    const oneId = (await h.t.db.selectFrom('skus').select('id').where('code', '=', one.code).executeTakeFirstOrThrow()).id;
    expect(await refusal(sizes().removeSize(watch, oneId, admin))).toEqual({ code: 'SIZE_LAST_OFFERED', status: 409, message: 'A model keeps at least one size offered.' });
    const typeless = await model('NOT-YT');
    expect(await refusal(sizes().declare(typeless, { ticked: ['52'] }, admin))).toEqual({ code: 'SIZE_TYPE_REQUIRED', status: 409, message: 'Give the model its size type first.' });
  });

  it('lets a script declare sizes (the system: set aside by no admin), never an account', async () => {
    const ring = await model('SYS-RG');
    await sizes().declare(ring, { sizeType: 'RING', ticked: ['50', '52'] }, SYSTEM_ACTOR);
    await h.ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: ring, material: '925 STERLING SILVER', variant: '52' }, SYSTEM_ACTOR);
    const s52 = (await h.t.db.selectFrom('skus').select('id').where('code', '=', 'SYS-RG-52').executeTakeFirstOrThrow()).id;
    expect(await sizes().removeSize(ring, s52, SYSTEM_ACTOR)).toEqual({ outcome: 'SET_ASIDE' });
    expect(await codes(ring)).toEqual([
      { code: 'SYS-RG-50', label: '50', offered: true, by: null },
      { code: 'SYS-RG-52', label: '52', offered: false, by: null },
    ]);
    expect(await refusal(sizes().reinstateSize(ring, s52, { type: 'account', id: '00000000-0000-4000-8000-000000000001' }))).toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('removes one size (deleted when unused, set aside otherwise) and reinstates it; a SKU of another model 404; audited by its code', async () => {
    const ring = await model('ONE-RG', 'RING');
    await sizes().declare(ring, { ticked: ['50', '52', '54'] }, admin);
    const id = async (label: string) => (await h.t.db.selectFrom('skus').select('id').where('model_id', '=', ring).where('size_label', '=', label).executeTakeFirstOrThrow()).id;
    const s54 = await id('54');
    await h.t.db.updateTable('skus').set({ shopify_variant_id: '9054' }).where('id', '=', s54).execute();
    expect(await sizes().removeSize(ring, await id('50'), admin)).toEqual({ outcome: 'REMOVED' });
    expect(await sizes().removeSize(ring, s54, admin)).toEqual({ outcome: 'SET_ASIDE' });
    expect(await refusal(sizes().removeSize(ring, s54, admin))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'Nothing has changed.' });
    expect(await refusal(sizes().removeSize(ring, await id('52'), admin))).toMatchObject({ code: 'SIZE_LAST_OFFERED' });
    const other = await model('OTH-RG', 'RING');
    expect(await refusal(sizes().removeSize(other, s54, admin))).toMatchObject({ code: 'SKU_NOT_FOUND', status: 404 });
    expect(await refusal(sizes().reinstateSize(other, s54, admin))).toMatchObject({ code: 'SKU_NOT_FOUND', status: 404 });
    const back = await sizes().reinstateSize(ring, s54, admin);
    expect([back.offered, back.setAside]).toEqual([2, 0]);
    expect(await refusal(sizes().reinstateSize(ring, s54, admin))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'Nothing has changed.' });
    expect((await declares(ring)).slice(0, 3)).toEqual([
      { added: [], reinstated: ['ONE-RG-54'], setAside: [], removed: [] },
      { added: [], reinstated: [], setAside: ['ONE-RG-54'], removed: [] },
      { added: [], reinstated: [], setAside: [], removed: ['ONE-RG-50'] },
    ]);
    // Through the routes: OPERATOR writes, AUDITOR reads only; the remove answers with the section.
    const url = (skuId: string, action: string) => `/api/admin/models/${ring}/sizes/${skuId}/${action}`;
    expect((await auditor.post(url(s54, 'remove'))).statusCode).toBe(403);
    let res = await operator.post(url(s54, 'remove'));
    expect(res.statusCode, res.body).toBe(200);
    expect(safeJson(res)).toMatchObject({ outcome: 'SET_ASIDE', sizes: { modelId: ring, offered: 1, setAside: 1 } });
    res = await operator.post(url(s54, 'reinstate'));
    expect(res.statusCode, res.body).toBe(200);
    expect(safeJson(res)).toMatchObject({ modelId: ring, offered: 2, setAside: 0 });
    expect(errorOf(await operator.post(url(s54, 'reinstate'), { extra: 1 })).code).toBe('VALIDATION_FAILED');
  });

  it('serves the PUT: a size type and the sizes ticked, or next-nine\'s size kind on a model with no type only (409 SIZE_TYPE_GIVEN on a typed one), never both at once', async () => {
    const typeless = await model('KND-RG');
    await ensureSku(h.t.db, typeless, '52');
    // Next-nine's kind on a model with no type: as before.
    expect((await sizes().setModelSizes(typeless, { sizeKind: 'RING' }, admin)).sizeKind).toBe('RING');
    const put = (body: unknown) => operator.request('PUT', `/api/admin/models/${typeless}/sizes`, { body });
    let res = await put({ sizeType: 'RING', sizeKind: 'RING' });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).message).toBe('Give a size type or a size kind, not both.');
    expect(await refusal(sizes().change(typeless, { sizeType: 'RING', sizeKind: 'RING' }, admin))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'Give a size type or a size kind, not both.' });
    // The sizes ticked with a size kind: refused alike, never the kind silently dropped.
    res = await put({ ticked: ['52'], sizeKind: 'RING' });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).message).toBe('Give a size type or a size kind, not both.');
    expect(await refusal(sizes().change(typeless, { ticked: ['52'], sizeKind: 'RING' }, admin))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'Give a size type or a size kind, not both.' });
    expect((await put({ sizeType: 'WRIST' })).statusCode).toBe(400);
    expect((await put({ ticked: ['x'.repeat(13)] })).statusCode).toBe(400);
    res = await put({ sizeType: 'RING', ticked: ['52', '54'] });
    expect(res.statusCode, res.body).toBe(200);
    expect(safeJson(res)).toMatchObject({ sizeType: 'RING', sizeKind: 'RING', offered: 2 });
    // Typed: the kind follows the type only.
    expect(await refusal(sizes().setModelSizes(typeless, { sizeKind: 'BRACELET' }, admin))).toEqual({ code: 'SIZE_TYPE_GIVEN', status: 409, message: 'This model has its size type: change it in Size type.' });
    res = await put({ sizeKind: null });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('SIZE_TYPE_GIVEN');
    // The fits stay next-nine's, in the same PUT as the sizes ticked.
    const s54 = (await h.t.db.selectFrom('skus').select('id').where('model_id', '=', typeless).where('size_label', '=', '54').executeTakeFirstOrThrow()).id;
    res = await put({ ticked: ['52', '54', '56'], fits: [{ skuId: s54, fitMinMm: 53, fitMaxMm: 55 }] });
    expect(res.statusCode, res.body).toBe(200);
    expect((safeJson(res) as any).sizes.find((z: any) => z.label === '54')).toMatchObject({ fitMinMm: 53, fitMaxMm: 55 });
    expect((await h.ctx.audit.list({ action: 'model.sizes.update', targetId: typeless })).items.map((e) => e.details)).toEqual([
      { skus: [s54] },
      { sizeKind: { before: null, after: 'RING' }, skus: [] },
    ]);
    // A model's record says its type and its offered sizes (the Catalogue's line).
    expect(safeJson(await auditor.get(`/api/admin/models/${typeless}`))).toMatchObject({ sizeType: 'RING', sizesOffered: 3 });
    expect((safeJson(await auditor.get('/api/admin/models')) as any).items.find((m: any) => m.id === typeless)).toMatchObject({ sizeType: 'RING', sizesOffered: 3 });
  });

  it('names a size as every flow does (offeredSku): a model with no type as before; a typed one by its label or its measure, its list\'s own label first, refusing a size not declared or set aside', async () => {
    const typeless = await model('OFF-NT');
    const first = await inTransaction(h.t.db, (tx) => offeredSku(tx, typeless, ' Size 61 '));
    expect(first).toMatchObject({ label: 'Size 61', typed: false });
    expect((await codes(typeless)).map((c) => c.code)).toEqual(['OFF-NT-SIZE-61']);
    const ring = await model('OFF-RG', 'RING');
    const parent = (await h.t.db.selectFrom('models').select('name').where('id', '=', ring).executeTakeFirstOrThrow()).name;
    expect(await refusal(inTransaction(h.t.db, (tx) => offeredSku(tx, ring, '53')))).toEqual({
      code: 'SIZE_NOT_DECLARED',
      status: 400,
      message: `Size 53 is not one of ${parent}’s sizes (none yet). Add it on the model’s page, in the Catalogue.`,
    });
    await ensureSku(h.t.db, ring, 'SIZE 52');
    await sizes().declare(ring, { ticked: ['50', '52', '54', '58'] }, admin);
    await ensureSku(h.t.db, ring, '52');
    const resolve = (label: string | null, opts: { allowSetAside?: boolean } = {}) => inTransaction(h.t.db, (tx) => offeredSku(tx, ring, label, opts));
    // By measure and by case; the list's own label preferred over SIZE 52.
    for (const asked of ['52', 'SIZE 52', 'size 52', '52 MM']) expect((await resolve(asked)).label, asked).toBe('52');
    expect(await resolve('54')).toMatchObject({ label: '54', typed: true });
    expect(await refusal(resolve('53'))).toEqual({ code: 'SIZE_NOT_DECLARED', status: 400, message: `Size 53 is not one of ${parent}’s sizes (50, 52, 54, 58, SIZE 52). Add it on the model’s page, in the Catalogue.` });
    expect(await refusal(resolve(null))).toMatchObject({ code: 'SIZE_NOT_DECLARED', message: `ONE SIZE is not one of ${parent}’s sizes (50, 52, 54, 58, SIZE 52). Add it on the model’s page, in the Catalogue.` });
    // Set aside: refused, unless allowed (the Generator, orders of earlier requests and releases).
    const s58 = (await h.t.db.selectFrom('skus').select('id').where('model_id', '=', ring).where('size_label', '=', '58').executeTakeFirstOrThrow()).id;
    await h.t.db.updateTable('skus').set({ shopify_variant_id: '9058' }).where('id', '=', s58).execute();
    await sizes().removeSize(ring, s58, admin);
    expect(await refusal(resolve('58'))).toEqual({ code: 'SIZE_SET_ASIDE', status: 409, message: `Size 58 of ${parent} is set aside. Reinstate it on the model’s page to offer it again.` });
    expect(await resolve('58', { allowSetAside: true })).toEqual({ skuId: s58, label: '58', typed: true });
    // A variant is named with its label; a model of one size lists ONE SIZE.
    const main = await model('OFF-MN', 'ONE_SIZE', 'PENDANT');
    const blue = await h.ctx.services.catalog.createVariant(main, { label: 'Blue', swatch: '#1F3A6B', skuPrefix: 'OFF-BL', mainLabel: 'Steel', mainSwatch: '#9D9B96' }, SYSTEM_ACTOR);
    // Plan NEXT LOT §3.3: the variant copies its main model's type and ONE SIZE.
    expect(await sizes().modelSizes(blue.id)).toMatchObject({ sizeType: 'ONE_SIZE', offered: 1 });
    const named = (await h.t.db.selectFrom('models').select('name').where('id', '=', main).executeTakeFirstOrThrow()).name;
    expect(await refusal(inTransaction(h.t.db, (tx) => offeredSku(tx, blue.id, '52')))).toMatchObject({ code: 'SIZE_NOT_DECLARED', message: `Size 52 is not one of ${named} · BLUE’s sizes (ONE SIZE). Add it on the model’s page, in the Catalogue.` });
    expect(await inTransaction(h.t.db, (tx) => offeredSku(tx, main, 'ONE SIZE'))).toMatchObject({ label: null, typed: true });
  });

  it('flags two sizes of one measure, the one off the list\'s own label reading «Same measure as 52»', async () => {
    const ring = await model('DUP-RG', 'RING');
    await ensureSku(h.t.db, ring, 'SIZE 52');
    await sizes().declare(ring, { ticked: ['50', '52'] }, admin);
    await ensureSku(h.t.db, ring, '52');
    const rows = await declaredSizes(h.t.db, ring);
    expect(rows.map((z) => [z.label, z.sameAs, z.onList])).toEqual([['50', null, true], ['52', null, true], ['SIZE 52', '52', true]]);
    // Unticking the measure takes both off.
    await sizes().declare(ring, { ticked: ['50'] }, admin);
    expect((await codes(ring)).map((c) => c.code)).toEqual(['DUP-RG-50']);
  });

  it('counts the orders waiting for supplier stock in a size (none before H2)', async () => {
    const ring = await model('AWT-RG', 'RING');
    await sizes().declare(ring, { ticked: ['52'] }, admin);
    expect((await declaredSizes(h.t.db, ring)).map((z) => z.awaiting)).toEqual([0]);
  });

  it('gives an order\'s exchange sizes: its model\'s offered sizes but its own, counted at its location, set-aside ones left out; none for a model of one size', async () => {
    const ring = await model('EXC-RG', 'RING');
    await sizes().declare(ring, { ticked: ['50', '52', '54', '56'] }, admin);
    const id = async (label: string) => (await h.t.db.selectFrom('skus').select('id').where('model_id', '=', ring).where('size_label', '=', label).executeTakeFirstOrThrow()).id;
    const locations = await h.t.db.selectFrom('stock_locations').select(['id', 'is_default']).execute();
    const home = locations.find((l) => l.is_default)!.id;
    const away = locations.find((l) => !l.is_default)!.id;
    await h.ctx.services.stock.adjust({ skuId: await id('50'), locationId: home, delta: 2, note: 'Counted.' }, admin);
    await h.ctx.services.stock.adjust({ skuId: await id('54'), locationId: away, delta: 3, note: 'Counted.' }, admin);
    await h.ctx.services.stock.adjust({ skuId: await id('56'), locationId: home, delta: 1, note: 'Counted.' }, admin);
    await sizes().removeSize(ring, await id('56'), admin);
    const account = (await h.t.db.insertInto('accounts').values({ email: 'exchange@example.com', email_normalized: 'exchange@example.com', password_hash: 'scrypt$x' }).returning('id').executeTakeFirstOrThrow()).id;
    const order = async (modelId: string, skuId: string) => {
      const r = await h.t.db.insertInto('shop_requests').values({ account_id: account, model_id: modelId, status: 'CLOSED', created_at: h.clock.now(), handled_at: h.clock.now(), outcome: 'ACCEPTED' }).returning('id').executeTakeFirstOrThrow();
      return (await h.t.db.insertInto('orders').values({ channel: 'SALON', shop_request_id: r.id, account_id: account, model_id: modelId, sku_id: skuId, location_id: home }).returning('id').executeTakeFirstOrThrow()).id;
    };
    expect(await sizesForExchange(h.t.db, await order(ring, await id('52')))).toEqual([
      { skuId: await id('50'), label: '50', available: 2, selectable: true },
      { skuId: await id('54'), label: '54', available: 0, selectable: false },
    ]);
    const watch = await model('EXC-WT', 'WATCH', 'AUTOMATIC WATCH');
    const one = (await h.t.db.selectFrom('skus').select('id').where('model_id', '=', watch).executeTakeFirstOrThrow()).id;
    expect(await sizesForExchange(h.t.db, await order(watch, one))).toEqual([]);
  });
});

/** Every foreign key to skus is a use of a size (SKU_USES), so a table added later without being listed fails here. */
describe('SKU_USES', () => {
  it('names every foreign key to skus in pg_constraint', async () => {
    const t = await createTestDb();
    try {
      const r = await sql<{ table: string; column: string }>`
        SELECT c.conrelid::regclass::text AS table, a.attname AS column
          FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[array_position(c.confkey, (SELECT attnum FROM pg_attribute WHERE attrelid = 'skus'::regclass AND attname = 'id'))]
         WHERE c.contype = 'f' AND c.confrelid = 'skus'::regclass
         ORDER BY 1, 2`.execute(t.db);
      const sorted = (xs: readonly { table: string; column: string }[]) => xs.map((x) => `${x.table}.${x.column}`).sort();
      expect(sorted(r.rows)).toEqual(sorted(SKU_USES.references));
      expect(r.rows.length).toBeGreaterThanOrEqual(6);
    } finally {
      await t.close();
    }
  });
});

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;

/** PGlite always (its transactions run one after another); PostgreSQL opt-in, a pool of 8: true parallelism. */
const BACKENDS: { name: string; skip: boolean; open(): Promise<{ db: Db; close(): Promise<void> }> }[] = [
  {
    name: 'PGlite',
    skip: false,
    async open() {
      const t = await createTestDb();
      return { db: t.db, close: () => t.close() };
    },
  },
  {
    name: 'PostgreSQL',
    skip: !adminUrl,
    async open() {
      const root = createDb(adminUrl!);
      const name = `orbes_sizes_${randomBytes(6).toString('hex')}`;
      await sql`CREATE DATABASE ${sql.id(name)}`.execute(root);
      const u = new URL(adminUrl!);
      u.pathname = `/${name}`;
      const db = createDb(u.toString(), { poolMax: 8 });
      await migrateToLatest(db);
      return {
        db,
        async close() {
          await closeDb(db);
          await sql`DROP DATABASE IF EXISTS ${sql.id(name)} WITH (FORCE)`.execute(root);
          await closeDb(root);
        },
      };
    },
  },
];

for (const backend of BACKENDS) {
  describe.skipIf(backend.skip)(`a size removed while a release or an order names it, on ${backend.name}`, () => {
    let handle: Awaited<ReturnType<(typeof BACKENDS)[number]['open']>>;
    let ctx: AppContext;
    let admin: Actor;
    let account: string;
    let location: string;
    let k = 0;

    beforeAll(async () => {
      handle = await backend.open();
      const clock = createManualClock('2026-10-07T09:00:00.000Z');
      ctx = await createContext(testConfig(), { db: handle.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
      await ctx.categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, SYSTEM_ACTOR);
      const a = await handle.db.insertInto('admin_users').values({ email: 'race@orbes.test', email_normalized: 'race@orbes.test', password_hash: 'scrypt$x', role: 'OPERATOR' }).returning('id').executeTakeFirstOrThrow();
      admin = { type: 'admin', id: a.id };
      account = (await handle.db.insertInto('accounts').values({ email: 'race@example.com', email_normalized: 'race@example.com', password_hash: 'scrypt$x' }).returning('id').executeTakeFirstOrThrow()).id;
      location = await defaultLocationId(handle.db);
    });
    afterAll(async () => {
      await ctx?.close();
      await handle?.close();
    });

    /** A ring with 50 and 52 offered; 52's SKU id. */
    async function ring(): Promise<{ modelId: string; s52: string; name: string }> {
      k++;
      const m = await ctx.services.catalog.createModel({ categoryCode: 'J', name: `RACE ${k}`, type: 'RING', skuPrefix: `RACE-${k}`, sizeType: 'RING' }, SYSTEM_ACTOR);
      await ctx.services.sizes.declare(m.id, { ticked: ['50', '52'] }, admin);
      const s52 = (await handle.db.selectFrom('skus').select('id').where('model_id', '=', m.id).where('size_label', '=', '52').executeTakeFirstOrThrow()).id;
      return { modelId: m.id, s52, name: m.name };
    }
    const pause = (tx: Db) => sql`SELECT pg_sleep(0.15)`.execute(tx);
    /** A release saved with size 52: offeredSku, a pause, then its size row referencing the SKU. */
    const release = (modelId: string, dropId: string) =>
      inTransaction(handle.db, async (tx) => {
        const s = await offeredSku(tx, modelId, '52');
        await pause(tx);
        await tx.insertInto('drop_sizes').values({ drop_id: dropId, label: s.label ?? 'ONE SIZE', position: 1, stock: 1, sku_id: s.skuId }).execute();
      });
    /** An order made in size 52: offeredSku, a pause, then the order inserted (its foreign key to the model too). */
    const order = (modelId: string) =>
      inTransaction(handle.db, async (tx) => {
        const s = await offeredSku(tx, modelId, '52');
        await pause(tx);
        const r = await tx.insertInto('shop_requests').values({ account_id: account, model_id: modelId, status: 'CLOSED', created_at: new Date('2026-10-07T09:00:00Z'), handled_at: new Date('2026-10-07T09:00:00Z'), outcome: 'ACCEPTED' }).returning('id').executeTakeFirstOrThrow();
        await tx.insertInto('orders').values({ channel: 'SALON', shop_request_id: r.id, account_id: account, model_id: modelId, size_label: s.label, sku_id: s.skuId, location_id: location }).execute();
      });
    const outcome = async (p: Promise<unknown>) => {
      try {
        const v = await p;
        return v && typeof v === 'object' && 'outcome' in v ? (v as { outcome: string }).outcome : 'ok';
      } catch (e) {
        if (e instanceof DomainError) return e.code;
        throw e;
      }
    };
    const later = <T>(ms: number, fn: () => Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => fn().then(resolve, reject), ms));
    const ALLOWED = [
      ['ok', 'SET_ASIDE'],
      ['SIZE_NOT_DECLARED', 'REMOVED'],
    ];

    for (const first of ['flow', 'removal'] as const) {
      it(`a release saved against the removal (${first} first): set aside, or SIZE_NOT_DECLARED, never a foreign-key failure`, async () => {
        const r = await ring();
        const drop = await ctx.services.drops.create({ modelId: r.modelId, title: 'DRAW', quantity: 1, opensAt: new Date('2026-11-01T09:00:00Z'), closesAt: new Date('2026-11-02T09:00:00Z'), earlyAccessHours: 0 }, admin);
        const flow = () => outcome(release(r.modelId, drop.id));
        const removal = () => outcome(ctx.services.sizes.removeSize(r.modelId, r.s52, admin));
        const got = first === 'flow' ? await Promise.all([flow(), later(40, removal)]) : (await Promise.all([removal(), later(40, flow)])).reverse();
        expect(ALLOWED).toContainEqual(got);
        const left = await handle.db.selectFrom('skus').select('set_aside_at').where('id', '=', r.s52).executeTakeFirst();
        if (got[1] === 'SET_ASIDE') expect(left?.set_aside_at).not.toBeNull();
        else expect(left).toBeUndefined();
      });

      it(`an order inserted for the model against the removal (${first} first): set aside, or SIZE_NOT_DECLARED, never a deadlock (40P01)`, async () => {
        const r = await ring();
        const flow = () => outcome(order(r.modelId));
        const removal = () => outcome(ctx.services.sizes.removeSize(r.modelId, r.s52, admin));
        const got = first === 'flow' ? await Promise.all([flow(), later(40, removal)]) : (await Promise.all([removal(), later(40, flow)])).reverse();
        expect(ALLOWED).toContainEqual(got);
        const orders = await handle.db.selectFrom('orders').select('sku_id').where('model_id', '=', r.modelId).execute();
        expect(orders.length).toBe(got[0] === 'ok' ? 1 : 0);
      });
    }
  });
}
