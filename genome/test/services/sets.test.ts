/**
 * THE SET's catalogue (macro scope of 2026-10-20, K44 T1; plan MACRO M3 §5.2 and §5.5, step M3.14; services/sets.ts), on
 * the service as createContext wires it:
 *
 *  - a set made of 2 to 4 different models, each active and sized (its size type declared, a size offered), in order:
 *    every other shape refused (422 SET_MODELS, naming what is wrong; 404 MODEL_NOT_FOUND for an unknown model); its name
 *    once whatever the case (409 SET_NAME_TAKEN), its code once and in capitals (409 SET_CODE_TAKEN), its base price
 *    with its currency or none; audited `set.create`; read with its pieces, their offered sizes and base prices;
 *  - changed field by field (`set.update`, before and after; nothing changed, nothing written), its pieces frozen once a
 *    release names it (409 SET_IN_USE) while its name, code and price still change; its releases listed;
 *  - set aside and reinstated (`set.set_aside`, `set.reinstate`), the active ones listed first;
 *  - its Shopify product pasted back (S5, `set.shopify`): a product a model's SKUs, an add-on or another set has is
 *    refused, and a model's or an add-on's link refuses a set's product (409 SHOPIFY_PRODUCT_TAKEN).
 * The routes are test/api/admin-sets.test.ts's; the set sold is test/services/set-sales.test.ts's.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import type { Actor } from '../../src/server/types.js';
import { createAdmin, createHarness, seedCatalog, type Harness } from '../api/support.js';
import { giveSizes } from '../support/draws.js';

async function refusal(p: Promise<unknown>): Promise<{ code: string; status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, status: e.httpStatus, message: e.publicMessage };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('SetService (plan MACRO M3 §5.2, T1)', () => {
  let h: Harness;
  let admin: Actor;
  let category: number;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-22T09:00:00.000Z');
    await seedCatalog(h.ctx);
    category = (await h.ctx.categories.getByCode('J'))!.index;
    admin = { type: 'admin', id: (await createAdmin(h.ctx, 'OPERATOR')).id };
  });
  afterAll(() => h?.close());

  const sets = () => h.ctx.services.sets;
  const db = () => h.t.db;
  const auditsOf = (id: string, action: string) => db().selectFrom('audit_logs').select('details').where('target_type', '=', 'set').where('target_id', '=', id).where('action', '=', action).orderBy('id').execute();

  /** A model, sized in `labels` (RING) unless none are given, with a base price when asked. */
  async function model(name: string, o: { labels?: string[]; type?: string; price?: [number, string]; variantOf?: string; variantLabel?: string; active?: boolean } = {}): Promise<string> {
    const m = await db()
      .insertInto('models')
      .values({
        category_id: category,
        name,
        type: o.type ?? 'RING',
        sku_prefix: `${name.slice(0, 3)}-${randomUUID().slice(0, 6).toUpperCase()}`,
        active: o.active ?? true,
        base_price_minor: o.price?.[0] ?? null,
        base_currency: o.price?.[1] ?? null,
        variant_of: o.variantOf ?? null,
        variant_label: o.variantLabel ?? null,
        variant_swatch: o.variantLabel ? '#123456' : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (o.labels) await giveSizes(db(), m.id, o.labels);
    return m.id;
  }

  it('makes a set of 2 to 4 different models, active and sized, in order, with its name, code and price; audited set.create', async () => {
    // A main model with a variant carries its own label (models_variant_rules).
    const ring = await model('HALO', { labels: ['52', '54', '56'], price: [60_000, 'EUR'], variantLabel: 'Silver' });
    const chain = await model('LINEA', { labels: ['45', '50'], type: 'NECKLACE' });
    const blue = await model('HALO', { labels: ['52'], variantOf: ring, variantLabel: 'Blue', price: [65_000, 'EUR'] });
    const made = await sets().create({ name: '  The   Pair ', code: 'the-pair', modelIds: [ring, chain], basePriceMinor: 90_000, baseCurrency: 'EUR' }, admin);
    expect(made).toMatchObject({
      name: 'The Pair',
      code: 'THE-PAIR',
      basePriceMinor: 90_000,
      baseCurrency: 'EUR',
      active: true,
      shopifyProductId: null,
      releases: [],
      pieces: [
        { position: 1, model: { id: ring, name: 'HALO', variant: 'Silver', type: 'RING', active: true, sizeType: 'RING' }, sizes: [{ label: '52' }, { label: '54' }, { label: '56' }], basePrice: { priceMinor: 60_000, currency: 'EUR' } },
        { position: 2, model: { id: chain, name: 'LINEA' }, sizes: [{ label: '45' }, { label: '50' }], basePrice: null },
      ],
    });
    expect(await auditsOf(made.id, 'set.create')).toEqual([{ details: { name: 'The Pair', code: 'THE-PAIR', modelIds: [ring, chain], basePriceMinor: 90_000, baseCurrency: 'EUR' } }]);
    // A variant is a model of its own; four pieces at most, no price at all.
    const four = await sets().create({ name: 'The Four', code: 'FOUR', modelIds: [blue, chain, ring, await model('ORBE', { labels: ['ONE SIZE'] })] }, admin);
    expect(four.pieces.map((p) => [p.position, p.model.variant])).toEqual([[1, 'Blue'], [2, null], [3, 'Silver'], [4, null]]);
    expect(four).toMatchObject({ basePriceMinor: null, baseCurrency: null });
    expect(four.pieces[0]!.basePrice).toEqual({ priceMinor: 65_000, currency: 'EUR' });
  });

  it('refuses every other shape: one model or five, a model twice, unknown, inactive, without sizes; a name or code taken', async () => {
    const a = await model('SOLO', { labels: ['52'] });
    const b = await model('DUO', { labels: ['45'], type: 'NECKLACE' });
    const extra = await Promise.all(['TRE', 'QUA', 'CIN'].map((n) => model(n, { labels: ['52'] })));
    const unsized = await model('NUDE');
    const asideOnly = await model('ASIDE', { labels: ['52'] });
    await db().updateTable('skus').set({ set_aside_at: new Date() }).where('model_id', '=', asideOnly).execute();
    const inactive = await model('GONE', { labels: ['52'], active: false });
    const make = (modelIds: string[], name = `S-${randomUUID().slice(0, 6)}`, code = `C-${randomUUID().slice(0, 6).toUpperCase()}`) => sets().create({ name, code, modelIds }, admin);
    expect(await refusal(make([a]))).toMatchObject({ code: 'SET_MODELS', status: 422, message: expect.stringContaining('It has 1 piece.') });
    expect(await refusal(make([a, b, ...extra]))).toMatchObject({ code: 'SET_MODELS', status: 422, message: expect.stringContaining('It has 5 pieces.') });
    expect(await refusal(make([a, a]))).toMatchObject({ code: 'SET_MODELS', message: expect.stringContaining('A model is chosen twice.') });
    expect(await refusal(make([a, randomUUID()]))).toMatchObject({ code: 'MODEL_NOT_FOUND', status: 404 });
    expect(await refusal(make([a, inactive]))).toMatchObject({ code: 'SET_MODELS', message: expect.stringContaining('GONE is not active.') });
    expect(await refusal(make([a, unsized]))).toMatchObject({ code: 'SET_MODELS', message: expect.stringContaining('NUDE has no size declared') });
    expect(await refusal(make([asideOnly, a]))).toMatchObject({ code: 'SET_MODELS', message: expect.stringContaining('ASIDE has no size declared') });
    await make([a, b], 'The Taken', 'TAKEN');
    expect(await refusal(make([a, b], 'the TAKEN'))).toEqual({ code: 'SET_NAME_TAKEN', status: 409, message: 'Another set has this name.' });
    expect(await refusal(make([a, b], 'Another', 'taken'))).toEqual({ code: 'SET_CODE_TAKEN', status: 409, message: 'Another set has this code.' });
    expect(await refusal(make([a, b], 'Bad code', '-BAD'))).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await refusal(sets().create({ name: 'Half price', code: 'HALF', modelIds: [a, b], basePriceMinor: 100 }, admin))).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await db().selectFrom('sets').select('id').where('code', 'in', ['HALF', '-BAD']).execute()).toEqual([]);
  });

  it('changes field by field; its pieces frozen once a release names it (409 SET_IN_USE), its name and price still free', async () => {
    const a = await model('ALPHA', { labels: ['52', '54'] });
    const b = await model('BETA', { labels: ['45'], type: 'NECKLACE' });
    const c = await model('GAMMA', { labels: ['18'], type: 'BRACELET' });
    const s = await sets().create({ name: 'The Trio', code: 'TRIO', modelIds: [a, b] }, admin);
    const changed = await sets().update(s.id, { name: 'The Duo', modelIds: [b, a, c], basePriceMinor: 120_000, baseCurrency: 'CHF' }, admin);
    expect(changed).toMatchObject({ name: 'The Duo', code: 'TRIO', basePriceMinor: 120_000, baseCurrency: 'CHF' });
    expect(changed.pieces.map((p) => p.model.id)).toEqual([b, a, c]);
    expect(await auditsOf(s.id, 'set.update')).toEqual([
      { details: { name: { from: 'The Trio', to: 'The Duo' }, basePrice: { from: null, to: { minor: 120_000, currency: 'CHF' } }, modelIds: { from: [a, b], to: [b, a, c] } } },
    ]);
    // The same again changes nothing and writes nothing.
    await sets().update(s.id, { name: 'The Duo', modelIds: [b, a, c] }, admin);
    expect(await auditsOf(s.id, 'set.update')).toHaveLength(1);
    expect(await refusal(sets().update(s.id, {}, admin))).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await refusal(sets().update(s.id, { modelIds: [a] }, admin))).toMatchObject({ code: 'SET_MODELS' });
    // A release names it: its pieces are frozen, the rest is not.
    const draw = await db()
      .insertInto('drops')
      .values({ set_id: s.id, title: 'THE DUO DRAW', quantity: 4, opens_at: new Date('2026-11-01T10:00:00Z'), closes_at: new Date('2026-11-02T10:00:00Z'), seed_enc: `v1.${'A'.repeat(16)}.${'B'.repeat(64)}`, seed_hash: new Uint8Array(32) })
      .returning('id')
      .executeTakeFirstOrThrow();
    expect(await refusal(sets().update(s.id, { modelIds: [a, b] }, admin))).toEqual({ code: 'SET_IN_USE', status: 409, message: 'A release already names this set: its pieces no longer change.' });
    const priced = await sets().update(s.id, { code: 'duo', basePriceMinor: null, baseCurrency: null, modelIds: [b, a, c] }, admin);
    expect(priced).toMatchObject({ code: 'DUO', basePriceMinor: null, baseCurrency: null, releases: [{ id: draw.id, mode: 'DRAW', title: 'THE DUO DRAW', publishedAt: null, cancelledAt: null }] });
    expect(priced.pieces.map((p) => p.model.id)).toEqual([b, a, c]);
    expect(await refusal(sets().get(randomUUID()))).toMatchObject({ code: 'SET_NOT_FOUND', status: 404 });
    expect(await refusal(sets().update('nope', { name: 'X' }, admin))).toMatchObject({ code: 'SET_NOT_FOUND' });
  });

  it('sets aside and reinstates (audited once each), the active ones listed first; and refuses a collector', async () => {
    const a = await model('OMEGA', { labels: ['52'] });
    const b = await model('SIGMA', { labels: ['45'], type: 'NECKLACE' });
    const s = await sets().create({ name: 'AAA First by name', code: 'AAA', modelIds: [a, b] }, admin);
    expect((await sets().setAside(s.id, admin)).active).toBe(false);
    await sets().setAside(s.id, admin);
    expect(await auditsOf(s.id, 'set.set_aside')).toEqual([{ details: { name: 'AAA First by name' } }]);
    const list = await sets().list();
    expect(list.at(-1)!.id).toBe(s.id);
    expect(list.slice(0, -1).every((x) => x.active)).toBe(true);
    expect((await sets().reinstate(s.id, admin)).active).toBe(true);
    expect(await auditsOf(s.id, 'set.reinstate')).toHaveLength(1);
    expect((await sets().list())[0]!.id).toBe(s.id);
    expect(await refusal(sets().setAside(s.id, { type: 'account', id: randomUUID() }))).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('keeps its Shopify product (S5): one product each among models, add-ons and sets, both ways; audited set.shopify', async () => {
    const a = await model('KAPPA', { labels: ['52'] });
    const b = await model('LAMBDA', { labels: ['45'], type: 'NECKLACE' });
    const s = await sets().create({ name: 'The Linked', code: 'LINKED', modelIds: [a, b] }, admin);
    const other = await sets().create({ name: 'The Other', code: 'OTHER', modelIds: [b, a] }, admin);
    expect((await sets().setShopify(s.id, { productId: 'https://admin.shopify.com/store/orbes/products/8801' }, admin)).shopifyProductId).toBe('8801');
    await sets().setShopify(s.id, { productId: '8801' }, admin);
    expect(await auditsOf(s.id, 'set.shopify')).toEqual([{ details: { product: { from: null, to: '8801' } } }]);
    const taken = { code: 'SHOPIFY_PRODUCT_TAKEN', status: 409, message: 'Another model, add-on or set is already linked to this Shopify product.' };
    expect(await refusal(sets().setShopify(other.id, { productId: '8801' }, admin))).toEqual(taken);
    // A model's SKUs or an add-on with the product: refused; and they refuse the set's.
    await db().updateTable('skus').set({ shopify_product_id: '8802' }).where('model_id', '=', a).execute();
    expect(await refusal(sets().setShopify(other.id, { productId: '8802' }, admin))).toEqual(taken);
    const addon = await h.ctx.services.addons.create({ name: 'Set Cloth', skuCode: 'SET-CLOTH' }, admin);
    await h.ctx.services.addons.setShopify(addon.id, { productId: '8803', variantId: null }, admin);
    expect(await refusal(sets().setShopify(other.id, { productId: '8803' }, admin))).toEqual(taken);
    expect(await refusal(h.ctx.services.addons.setShopify(addon.id, { productId: '8801', variantId: null }, admin))).toEqual(taken);
    expect(await refusal(h.ctx.services.shopify.link(b, { productId: '8801', variants: [] }, admin))).toEqual(taken);
    expect((await sets().setShopify(s.id, { productId: null }, admin)).shopifyProductId).toBeNull();
    expect(await refusal(sets().setShopify(s.id, { productId: 'not a product' }, admin))).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
