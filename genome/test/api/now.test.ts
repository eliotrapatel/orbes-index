/**
 * What NOW reads (plan NOCTURNE, step N3), through the routes:
 *
 *  - the lookbook's lists: each entry says when it was last added to the collection (`publishedAt`, the latest first
 *    shown of its models in the list, each dot its own), so NOW leads with the newest; and an entry and a sheet carry
 *    the sizes of the model and its variants (addition 8), from lot E's SKUs: each size once whatever its case, in a
 *    client's order, one size naming none;
 *  - the account's pieces: each names its model's sheet (`lookbook`) when the model is PUBLIC, or RESERVED from a tier
 *    the account reaches (N6, THE PRIVATE SALON), so « You own two: steel and gold » counts the pieces of a model and
 *    its variants; a HIDDEN model, or a RESERVED one above the account's tier, is named by none.
 *  (The feed's invitations, their places and NOW's read without a visit: test/api/circle.test.ts.)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureSku, sizesOnce } from '../../src/server/services/stock.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { accountClient, adminClient, createHarness, issue, safeJson, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

const HOUR = 3_600_000;

interface CardJson {
  slug: string;
  publishedAt: string | null;
  sizes: string[];
  variants: { slug: string; label: string; publishedAt: string | null }[];
}

describe('NOW\'s reads (NOCTURNE N3)', () => {
  let h: Harness;
  let operator: Client;
  let catalog: Catalog;
  let goldId: string;
  let auroreId: string;
  const times: Record<string, string> = {};

  const patch = async (id: string, body: unknown) => {
    const res = await operator.patch(`/api/admin/models/${id}`, body);
    expect(res.statusCode, res.body).toBe(200);
  };
  const list = async () => (safeJson(await h.client().get('/api/v1/lookbook')) as { models: CardJson[] }).models;

  beforeAll(async () => {
    h = await createHarness();
    operator = await adminClient(h, 'OPERATOR');
    catalog = await seedCatalog(h.ctx);
    const aurore = safeJson(await operator.post('/api/admin/models', { categoryCode: 'J', name: 'AURORE', type: 'RING', skuPrefix: 'NOW-AU', sizeType: 'RING' })) as { id: string };
    auroreId = aurore.id;
    const gold = await operator.post(`/api/admin/models/${catalog.modelId}/variants`, { label: 'Gold', swatch: '#B88A3A', skuPrefix: 'NOW-GD', mainLabel: 'Steel', mainSwatch: '#9D9B96' });
    expect(gold.statusCode, gold.body).toBe(201);
    goldId = (safeJson(gold) as { id: string }).id;
    // Published in this order: AURORE, then MONOLITHE in steel, then in gold an hour later.
    times.aurore = h.clock.now().toISOString();
    await patch(auroreId, { lookbook: 'PUBLIC', slug: 'now-aurore' });
    h.clock.advance(HOUR);
    times.steel = h.clock.now().toISOString();
    await patch(catalog.modelId, { lookbook: 'PUBLIC', slug: 'now-monolithe' });
    h.clock.advance(HOUR);
    times.gold = h.clock.now().toISOString();
    await patch(goldId, { lookbook: 'PUBLIC', slug: 'now-monolithe-gold' });
    // The SKUs of the house: 16 and 17 in steel, 17, 18 and one size in gold (« ONE SIZE » names no size).
    for (const [id, size] of [
      [catalog.modelId, '17'],
      [catalog.modelId, '16'],
      [goldId, '18'],
      [goldId, '17'],
      [goldId, null],
    ] as const)
      await ensureSku(h.ctx.db, id, size);
  });
  afterAll(() => h?.close());

  it('says when each entry was last added to the collection, each dot its own: the newest is NOW\'s', async () => {
    const models = await list();
    const mono = models.find((c) => c.slug === 'now-monolithe')!;
    expect(mono.publishedAt).toBe(times.gold);
    expect(mono.variants.map((d) => [d.label, d.publishedAt])).toEqual([
      ['Steel', times.steel],
      ['Gold', times.gold],
    ]);
    expect(models.find((c) => c.slug === 'now-aurore')!.publishedAt).toBe(times.aurore);
    // A model shown once keeps its date: hidden and shown again, it is not newer.
    await patch(auroreId, { lookbook: 'HIDDEN' });
    h.clock.advance(HOUR);
    await patch(auroreId, { lookbook: 'PUBLIC' });
    expect((await list()).find((c) => c.slug === 'now-aurore')!.publishedAt).toBe(times.aurore);
  });

  it('carries the sizes of a model and its variants from their SKUs, on an entry and on a sheet (addition 8)', async () => {
    const models = await list();
    expect(models.find((c) => c.slug === 'now-monolithe')!.sizes).toEqual(['16', '17', '18']);
    expect(models.find((c) => c.slug === 'now-aurore')!.sizes).toEqual([]);
    for (const slug of ['now-monolithe', 'now-monolithe-gold']) {
      const sheet = safeJson(await h.client().get(`/api/v1/lookbook/${slug}`)) as { sizes: string[] };
      expect(sheet.sizes, slug).toEqual(['16', '17', '18']);
    }
    // Each size once whatever its case (the first kept), naturally ordered.
    expect(sizesOnce(['M', '52', 'l', '48', 'm', 'L'])).toEqual(['48', '52', 'l', 'M']);
  });

  it('names each piece\'s model sheet when it is PUBLIC, or RESERVED from the account\'s tier, so NOW counts a model\'s pieces across its variants', async () => {
    const { client } = await accountClient(h);
    for (const modelId of [catalog.modelId, goldId]) {
      const piece = await issue(h.ctx, { ...catalog, modelId });
      await h.ctx.services.warranty.activate(piece.product.productId, { purchaseDate: '2026-09-01' }, SYSTEM_ACTOR);
      const scan = safeJson(await client.post('/api/v1/verify', { code: piece.code.data })) as { registration: { token: string } };
      expect((await client.post('/api/v1/ownership/register', { registrationToken: scan.registration.token })).statusCode).toBe(201);
    }
    const mine = async () => ((safeJson(await client.get('/api/v1/account/products')) as { products: { modelVariant: string | null; lookbook: string | null }[] }).products).map((p) => [p.modelVariant, p.lookbook]);
    expect((await mine()).sort()).toEqual([
      ['Gold', 'now-monolithe-gold'],
      ['Steel', 'now-monolithe'],
    ]);
    // A RESERVED model is the salon's: named to an owner whose tier reaches it (two pieces: TITANE), as its sheet is
    // answered, never above it; a HIDDEN one is nobody's.
    await patch(goldId, { lookbook: 'RESERVED', privateMinTier: 1 });
    await patch(catalog.modelId, { lookbook: 'HIDDEN' });
    expect((await mine()).sort()).toEqual([
      ['Gold', 'now-monolithe-gold'],
      ['Steel', null],
    ]);
    await patch(goldId, { privateMinTier: 2 });
    expect((await mine()).sort()).toEqual([
      ['Gold', null],
      ['Steel', null],
    ]);
  });
});
