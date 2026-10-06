/**
 * The variants of a model and a draw's price (plan NOCTURNE, step N1; migration 0024), through the routes:
 *
 *  - the console: ADD A VARIANT (POST /api/admin/models/:id/variants, OPERATOR): a model copied from its main model
 *    (category, collection, name, type, story, specifications, care), its own label, colour and SKU prefix, HIDDEN; the
 *    main model's own label and colour given by its first variant; audited `model.variant.create` (and `model.update`
 *    for the main model's dot); refused for a variant (never chained), a label of the group taken, a SKU prefix taken; a
 *    label and its colour changed together, kept by a variant and a model with variants; a model's page names its
 *    variants, a variant's names its main model;
 *  - the lookbook: a model and its variants one entry of a list, its dots in order (the main model first), a hidden
 *    variant no dot; a variant's own address opens the sheet with it selected, each dot with its photographs and facts;
 *    THE PRIVATE SALON alike, each reserved dot with its price and the account's own request;
 *  - the labels: a piece, its result, an order and a release name the model's variant (« MONOLITHE in blue »);
 *  - a draw's price: set in the console with its currency (both or neither, fixed once published), on the draw's card
 *    and page, and taken by the order of each entry Client Services confirms, instead of « to be confirmed ».
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeSwatch, normalizeVariantLabel, VARIANT_LABEL_MAX } from '../../src/server/services/catalog.js';
import { DRAW_PRICE_MAX_MINOR } from '../../src/server/services/drops.js';
import { ORDER_AMOUNT_MAX_MINOR } from '../../src/server/services/orders.js';
import { DomainError } from '../../src/server/errors.js';
import { SYSTEM_ACTOR, type Actor } from '../../src/server/types.js';
import { jpegPhoto } from '../support/images.js';
import { accountClient, adminClient, createAdmin, createHarness, errorOf, issue, safeJson, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

const HOUR = 3_600_000;

interface VariantJson {
  id: string;
  name: string;
  label: string | null;
  swatch: string | null;
  skuPrefix: string;
  imageUrl: string | null;
  lookbook: string;
  slug: string | null;
  active: boolean;
}

interface ModelJson {
  id: string;
  name: string;
  type: string;
  skuPrefix: string;
  category: { code: string };
  collection: { id: string; name: string } | null;
  defaultMaterial: string | null;
  careInstructions: string | null;
  story: string | null;
  specs: string | null;
  careGuide: string | null;
  lookbook: string;
  slug: string | null;
  active: boolean;
  variantOf: { id: string; name: string; label: string | null } | null;
  variantLabel: string | null;
  variantSwatch: string | null;
  variants: VariantJson[];
}

interface Dot {
  slug: string;
  name: string;
  type: string;
  label: string;
  swatch: string;
  imageUrl: string | null;
  priceLabel?: string | null;
  minTier?: number;
}

interface CardJson {
  slug: string;
  name: string;
  variant: { label: string; swatch: string } | null;
  variants: Dot[];
  priceLabel?: string | null;
}

interface SheetVariantJson {
  slug: string;
  label: string;
  swatch: string;
  selected: boolean;
  lookbook: string;
  coverUrl: string | null;
  gallery: { url: string; alt: string | null }[];
  specs: { label: string; value: string }[];
  care: string | null;
  discontinuedYear: number | null;
  salon?: { priceLabel: string | null; minTier: number; request?: { id: string } | null };
}

interface SheetJson {
  slug: string;
  coverUrl: string | null;
  specs: { label: string; value: string }[];
  variant: { label: string; swatch: string } | null;
  variants: SheetVariantJson[];
  salon?: { priceLabel: string | null; request?: { id: string } | null };
}

describe('the variants of a model (NOCTURNE N1)', () => {
  let h: Harness;
  let operator: Client;
  let auditor: Client;
  let catalog: Catalog;

  const url = (id: string) => `/api/admin/models/${id}`;
  const read = async (id: string) => safeJson(await auditor.get(url(id))) as ModelJson;
  const addVariant = (id: string, body: unknown) => operator.post(`${url(id)}/variants`, body);
  const audits = (action: string, target?: string) =>
    h.ctx.db
      .selectFrom('audit_logs')
      .selectAll()
      .where('action', '=', action)
      .$if(target !== undefined, (q) => q.where('target_id', '=', target!))
      .orderBy('id')
      .execute();
  const publicList = async () => (safeJson(await h.client().get('/api/v1/lookbook')) as { models: CardJson[] }).models;
  const photo = async (id: string, w: number) => {
    const res = await operator.request('POST', `${url(id)}/image`, { body: Buffer.from(jpegPhoto(w, 40)), headers: { 'content-type': 'image/jpeg' } });
    expect(res.statusCode, res.body).toBe(200);
    return (safeJson(res) as { imageUrl: string }).imageUrl;
  };

  beforeAll(async () => {
    h = await createHarness();
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    catalog = await seedCatalog(h.ctx);
    // The main model's sheet, as ADD A VARIANT copies it.
    expect(
      (
        await operator.patch(url(catalog.modelId), {
          story: 'Two rails held apart, closed by one angled link.',
          specs: 'Metal: 925 sterling silver\nClosure: Hinged',
          careGuide: 'Wipe it with a soft, dry cloth.',
        })
      ).statusCode,
    ).toBe(200);
  });
  afterAll(() => h?.close());

  it('holds a label to one line of 1 to 40 characters and a colour to #RRGGBB, kept in capitals', () => {
    expect(VARIANT_LABEL_MAX).toBe(40);
    expect(normalizeVariantLabel('  Night   blue ')).toBe('Night blue');
    for (const none of [null, undefined, '', '   ']) expect(normalizeVariantLabel(none)).toBeNull();
    for (const bad of ['x'.repeat(41), 'Blue\u0007', 42]) expect(() => normalizeVariantLabel(bad), String(bad)).toThrow(DomainError);
    expect(normalizeSwatch('#16224a')).toBe('#16224A');
    expect(normalizeSwatch('b88a3a')).toBe('#B88A3A');
    for (const none of [null, undefined, '', ' ']) expect(normalizeSwatch(none)).toBeNull();
    for (const bad of ['#16224', '#16224AA', 'blue', 7]) expect(() => normalizeSwatch(bad), String(bad)).toThrow(DomainError);
  });

  it('ADD A VARIANT: a model copied from its main model, its own label, colour and SKU prefix, HIDDEN; the main model given its own dot; audited', async () => {
    // The main model has no label yet: its first variant asks for it.
    const missing = await addVariant(catalog.modelId, { label: 'Gold', swatch: '#b88a3a', skuPrefix: 'VAR-GD' });
    expect([missing.statusCode, errorOf(missing).code]).toEqual([400, 'VALIDATION_FAILED']);
    expect(errorOf(missing).message).toBe('Give this model its own label and colour first: it is one of the dots of its variants.');
    const res = await addVariant(catalog.modelId, { label: 'Gold', swatch: '#b88a3a', skuPrefix: 'var-gd', mainLabel: 'Steel', mainSwatch: '9d9b96' });
    expect(res.statusCode, res.body).toBe(201);
    const gold = safeJson(res) as ModelJson;
    const main = await read(catalog.modelId);
    expect(gold).toMatchObject({
      name: main.name,
      type: main.type,
      skuPrefix: 'VAR-GD',
      category: { code: 'J' },
      collection: main.collection,
      careInstructions: main.careInstructions,
      story: main.story,
      specs: main.specs,
      careGuide: main.careGuide,
      // Its own, set on its page: its material, prices, photographs and publication.
      defaultMaterial: null,
      lookbook: 'HIDDEN',
      slug: null,
      active: true,
      variantOf: { id: catalog.modelId, name: 'MONOLITHE', label: 'Steel' },
      variantLabel: 'Gold',
      variantSwatch: '#B88A3A',
      variants: [],
    });
    expect(main).toMatchObject({ variantOf: null, variantLabel: 'Steel', variantSwatch: '#9D9B96' });
    expect(main.variants).toEqual([{ id: gold.id, name: 'MONOLITHE', label: 'Gold', swatch: '#B88A3A', skuPrefix: 'VAR-GD', imageUrl: null, lookbook: 'HIDDEN', slug: null, active: true }]);
    // Audited: the variant with what it copied; the main model's dot as a change of it.
    const [created] = await audits('model.variant.create', gold.id);
    expect(created!.details).toEqual({
      mainId: catalog.modelId,
      name: 'MONOLITHE',
      type: 'RING',
      skuPrefix: 'VAR-GD',
      category: 'J',
      collectionId: catalog.collectionId,
      label: 'Gold',
      swatch: '#B88A3A',
      copied: ['type', 'collection', 'story', 'specs', 'care'],
    });
    expect((await audits('model.update', catalog.modelId)).at(-1)!.details).toMatchObject({ before: { variantLabel: null, variantSwatch: null }, after: { variantLabel: 'Steel', variantSwatch: '#9D9B96' } });

    // A second variant: in the order they were added; the main model's dot already given (what is sent for it is not read).
    h.clock.advance(1000);
    const blue = safeJson(await addVariant(catalog.modelId, { label: 'Blue', swatch: '#16224A', skuPrefix: 'VAR-BL' })) as ModelJson;
    expect((await read(catalog.modelId)).variants.map((v) => v.label)).toEqual(['Gold', 'Blue']);

    // Refused: a variant of a variant (never chained), a label of the group whatever its case, a SKU prefix taken, the forms.
    const chained = await addVariant(blue.id, { label: 'Night', swatch: '#0A0A0A', skuPrefix: 'VAR-NT' });
    expect([chained.statusCode, errorOf(chained).code]).toEqual([409, 'MODEL_IS_VARIANT']);
    for (const label of ['gold', 'STEEL']) {
      const taken = await addVariant(catalog.modelId, { label, swatch: '#0A0A0A', skuPrefix: `VAR-${label}` });
      expect([taken.statusCode, errorOf(taken).code], label).toEqual([409, 'VARIANT_LABEL_TAKEN']);
    }
    const prefix = await addVariant(catalog.modelId, { label: 'Night', swatch: '#0A0A0A', skuPrefix: 'VAR-GD' });
    expect([prefix.statusCode, errorOf(prefix).code]).toEqual([409, 'SKU_PREFIX_TAKEN']);
    for (const body of [
      { label: '', swatch: '#0A0A0A', skuPrefix: 'VAR-X' },
      { label: 'x'.repeat(41), swatch: '#0A0A0A', skuPrefix: 'VAR-X' },
      { label: 'Night', swatch: 'night', skuPrefix: 'VAR-X' },
      { label: 'Night', swatch: '#0A0A0A', skuPrefix: 'VAR X!' },
      { label: 'Night', swatch: '#0A0A0A', skuPrefix: 'VAR-X', mainLabel: 'Steel' },
      { label: 'Night', swatch: '#0A0A0A', skuPrefix: 'VAR-X', surprise: true },
    ]) {
      expect(errorOf(await addVariant(catalog.modelId, body)).code, JSON.stringify(body)).toBe('VALIDATION_FAILED');
    }
    expect(errorOf(await addVariant('00000000-0000-4000-8000-000000000000', { label: 'Night', swatch: '#0A0A0A', skuPrefix: 'VAR-X' })).code).toBe('MODEL_NOT_FOUND');
    expect((await audits('model.variant.create')).map((a) => a.target_id)).toEqual([gold.id, blue.id]);
  });

  it('a label and its colour change together; a variant and a model with variants keep theirs; a label of the group is taken', async () => {
    const main = await read(catalog.modelId);
    const [gold, blue] = main.variants;
    const refused = async (id: string, body: unknown) => {
      const res = await operator.patch(url(id), body);
      return [res.statusCode, errorOf(res).code];
    };
    expect(await refused(gold!.id, { variantLabel: 'Yellow gold' })).toEqual([400, 'VALIDATION_FAILED']);
    expect(await refused(gold!.id, { variantLabel: null, variantSwatch: null })).toEqual([409, 'VARIANT_LABEL_REQUIRED']);
    expect(await refused(catalog.modelId, { variantLabel: null, variantSwatch: null })).toEqual([409, 'VARIANT_LABEL_REQUIRED']);
    expect(await refused(blue!.id, { variantLabel: 'GOLD', variantSwatch: '#16224A' })).toEqual([409, 'VARIANT_LABEL_TAKEN']);
    const renamed = safeJson(await operator.patch(url(gold!.id), { variantLabel: 'Yellow gold', variantSwatch: '#f0d692' })) as ModelJson;
    expect([renamed.variantLabel, renamed.variantSwatch]).toEqual(['Yellow gold', '#F0D692']);
    expect((await audits('model.update', gold!.id)).at(-1)!.details).toMatchObject({ before: { variantLabel: 'Gold', variantSwatch: '#B88A3A' }, after: { variantLabel: 'Yellow gold', variantSwatch: '#F0D692' } });
    expect((safeJson(await operator.patch(url(gold!.id), { variantLabel: 'Gold', variantSwatch: '#B88A3A' })) as ModelJson).variantLabel).toBe('Gold');
    // A model alone may drop its own.
    const alone = safeJson(await operator.post('/api/admin/models', { categoryCode: 'J', name: 'AURORE', type: 'PENDANT', skuPrefix: 'VAR-AUR' })) as ModelJson;
    expect((safeJson(await operator.patch(url(alone.id), { variantLabel: 'Silver', variantSwatch: '#D7D5D0' })) as ModelJson).variantLabel).toBe('Silver');
    expect((safeJson(await operator.patch(url(alone.id), { variantLabel: '', variantSwatch: '' })) as ModelJson).variantLabel).toBeNull();
    // The list says the same as the page.
    const listed = (safeJson(await auditor.get('/api/admin/models')) as { items: ModelJson[] }).items;
    expect(listed.find((m) => m.id === catalog.modelId)).toEqual(await read(catalog.modelId));
    expect(listed.find((m) => m.id === blue!.id)!.variantOf).toEqual({ id: catalog.modelId, name: 'MONOLITHE', label: 'Steel' });
  });

  it('the lookbook: a model and its variants one entry, its dots in order; a hidden variant no dot; a variant\'s address opens the sheet with it selected', async () => {
    const main = await read(catalog.modelId);
    const [gold, blue] = main.variants;
    const steelUrl = await photo(catalog.modelId, 40);
    const goldUrl = await photo(gold!.id, 41);
    await photo(blue!.id, 42);
    expect((await operator.patch(url(catalog.modelId), { lookbook: 'PUBLIC', slug: 'variants-monolithe' })).statusCode).toBe(200);
    expect((await operator.patch(url(gold!.id), { lookbook: 'PUBLIC', slug: 'variants-monolithe-gold', specs: 'Metal: 18k yellow gold\nClosure: Hinged' })).statusCode).toBe(200);
    // Blue stays HIDDEN: no dot of it, anywhere.
    let list = await publicList();
    expect(list.map((c) => c.slug)).toEqual(['variants-monolithe']);
    expect(list[0]).toMatchObject({ slug: 'variants-monolithe', variant: { label: 'Steel', swatch: '#9D9B96' } });
    expect(list[0]!.variants).toEqual([
      { slug: 'variants-monolithe', name: 'MONOLITHE', type: 'RING', label: 'Steel', swatch: '#9D9B96', imageUrl: steelUrl },
      { slug: 'variants-monolithe-gold', name: 'MONOLITHE', type: 'RING', label: 'Gold', swatch: '#B88A3A', imageUrl: goldUrl },
    ]);
    expect((await operator.patch(url(blue!.id), { lookbook: 'PUBLIC', slug: 'variants-monolithe-blue' })).statusCode).toBe(200);
    list = await publicList();
    expect(list).toHaveLength(1);
    expect(list[0]!.variants.map((d) => d.label)).toEqual(['Steel', 'Gold', 'Blue']);

    // A variant's own address: its sheet, selected among the dots, each with its photographs and facts.
    const sheet = safeJson(await h.client().get('/api/v1/lookbook/variants-monolithe-gold')) as SheetJson;
    expect(sheet).toMatchObject({ slug: 'variants-monolithe-gold', coverUrl: goldUrl, variant: { label: 'Gold', swatch: '#B88A3A' } });
    expect(sheet.specs).toEqual([
      { label: 'Metal', value: '18k yellow gold' },
      { label: 'Closure', value: 'Hinged' },
    ]);
    expect(sheet.variants.map((v) => [v.slug, v.label, v.selected])).toEqual([
      ['variants-monolithe', 'Steel', false],
      ['variants-monolithe-gold', 'Gold', true],
      ['variants-monolithe-blue', 'Blue', false],
    ]);
    expect(sheet.variants[0]).toMatchObject({ coverUrl: steelUrl, gallery: [], care: 'Polish with a soft dry cloth.', discontinuedYear: null, lookbook: 'PUBLIC' });
    expect(sheet.variants[0]!.specs[0]).toEqual({ label: 'Metal', value: '925 sterling silver' });
    expect(sheet.variants[0]).not.toHaveProperty('salon');
    // The main model's address: the same dots, the main model selected.
    const first = safeJson(await h.client().get('/api/v1/lookbook/variants-monolithe')) as SheetJson;
    expect(first.variants.filter((v) => v.selected).map((v) => v.slug)).toEqual(['variants-monolithe']);

    // The main model HIDDEN again: the first variant shown leads the entry.
    expect((await operator.patch(url(catalog.modelId), { lookbook: 'HIDDEN' })).statusCode).toBe(200);
    list = await publicList();
    expect(list.map((c) => [c.slug, c.variants.map((d) => d.label)])).toEqual([['variants-monolithe-gold', ['Gold', 'Blue']]]);
    expect(errorOf(await h.client().get('/api/v1/lookbook/variants-monolithe')).code).toBe('LOOKBOOK_NOT_FOUND');
    expect((await operator.patch(url(catalog.modelId), { lookbook: 'PUBLIC' })).statusCode).toBe(200);
  });

  it('THE PRIVATE SALON: its reserved variants one entry with their prices; each dot of a sheet with the account\'s own request', async () => {
    const main = await read(catalog.modelId);
    const salon = safeJson(await operator.post('/api/admin/models', { categoryCode: 'J', name: 'ZENITH', type: 'BRACELET', skuPrefix: 'VAR-ZN' })) as ModelJson;
    const night = safeJson(await addVariant(salon.id, { label: 'Night', swatch: '#0A0A0A', skuPrefix: 'VAR-ZN-NT', mainLabel: 'Day', mainSwatch: '#F6F2EA' })) as ModelJson;
    expect((await operator.patch(url(salon.id), { lookbook: 'RESERVED', slug: 'variants-zenith', priceLabel: '€ 4 800', privateMinTier: 1 })).statusCode).toBe(200);
    expect((await operator.patch(url(night.id), { lookbook: 'RESERVED', slug: 'variants-zenith-night', priceLabel: '€ 5 200', privateMinTier: 1 })).statusCode).toBe(200);
    // An owner (a piece of MONOLITHE in steel) reads the salon.
    const { client } = await accountClient(h);
    const owned = await issue(h.ctx, catalog);
    await h.ctx.services.warranty.activate(owned.product.productId, { purchaseDate: '2026-09-01' }, SYSTEM_ACTOR);
    const scan = safeJson(await client.post('/api/v1/verify', { code: owned.code.data })) as { registration: { token: string } };
    expect((await client.post('/api/v1/ownership/register', { registrationToken: scan.registration.token })).statusCode).toBe(201);
    const cards = (safeJson(await client.get('/api/v1/club/lookbook')) as { models: CardJson[] }).models;
    expect(cards.map((c) => c.slug)).toEqual(['variants-zenith']);
    expect(cards[0]).toMatchObject({ priceLabel: '€ 4 800', variant: { label: 'Day', swatch: '#F6F2EA' } });
    expect(cards[0]!.variants.map((d) => [d.slug, d.label, d.priceLabel, d.minTier])).toEqual([
      ['variants-zenith', 'Day', '€ 4 800', 1],
      ['variants-zenith-night', 'Night', '€ 5 200', 1],
    ]);
    // The account requests the night one: its dot says so, the other's does not.
    expect((await client.post('/api/v1/club/lookbook/variants-zenith-night/request', {})).statusCode).toBe(201);
    const sheet = safeJson(await client.get('/api/v1/club/lookbook/variants-zenith')) as SheetJson;
    expect(sheet.salon?.request ?? null).toBeNull();
    expect(sheet.variants.map((v) => [v.slug, v.selected, v.salon?.priceLabel, v.salon?.request ? 'REQUESTED' : null])).toEqual([
      ['variants-zenith', true, '€ 4 800', null],
      ['variants-zenith-night', false, '€ 5 200', 'REQUESTED'],
    ]);
    // A RESERVED group is the salon's, not THE COLLECTION's: the public list is unchanged, MONOLITHE alone.
    expect((await publicList()).map((c) => c.slug)).toEqual([main.slug ?? 'variants-monolithe']);
  });

  it('names the model\'s variant on a piece, its result, an order and a release (« MONOLITHE in blue »)', async () => {
    const blue = (await read(catalog.modelId)).variants.find((v) => v.label === 'Blue')!;
    const blueCatalog: Catalog = { ...catalog, modelId: blue.id };
    const { client } = await accountClient(h);
    const piece = await issue(h.ctx, blueCatalog);
    await h.ctx.services.warranty.activate(piece.product.productId, { purchaseDate: '2026-09-01' }, SYSTEM_ACTOR);
    const result = safeJson(await client.post('/api/v1/verify', { code: piece.code.data })) as { product: { model: string; modelVariant?: string }; registration: { token: string } };
    expect(result.product).toMatchObject({ model: 'MONOLITHE', modelVariant: 'Blue' });
    expect((await client.post('/api/v1/ownership/register', { registrationToken: result.registration.token })).statusCode).toBe(201);
    const pieces = (safeJson(await client.get('/api/v1/account/products')) as { products: { model: string; modelVariant: string | null }[] }).products;
    expect(pieces.map((p) => [p.model, p.modelVariant])).toEqual([['MONOLITHE', 'Blue']]);
    // A model without a variant: none named.
    const plain = await issue(h.ctx, { ...catalog, modelId: (await read(catalog.modelId)).variants[0]!.id });
    expect((safeJson(await h.client().post('/api/v1/verify', { code: plain.code.data })) as { product: { modelVariant?: string } }).product.modelVariant).toBe('Gold');
    const aurore = (safeJson(await auditor.get('/api/admin/models')) as { items: ModelJson[] }).items.find((m) => m.name === 'AURORE')!;
    const alone = await issue(h.ctx, { ...catalog, modelId: aurore.id });
    expect((safeJson(await h.client().post('/api/v1/verify', { code: alone.code.data })) as { product: Record<string, unknown> }).product).not.toHaveProperty('modelVariant');
  });

  it('a draw\'s price: set in the console with its currency, fixed once published, on its card and page; the order of an entry confirmed takes it', async () => {
    expect(DRAW_PRICE_MAX_MINOR).toBe(ORDER_AMOUNT_MAX_MINOR);
    const blue = (await read(catalog.modelId)).variants.find((v) => v.label === 'Blue')!;
    const admin = await createAdmin(h.ctx, 'ADMIN');
    const actor: Actor = { type: 'admin', id: admin.id };
    const at = (ms: number) => new Date(h.clock.now().getTime() + ms).toISOString();
    const body = { modelId: blue.id, title: 'MONOLITHE, THE BLUE DRAW', quantity: 2, opensAt: at(HOUR), closesAt: at(2 * HOUR), earlyAccessHours: 0 };
    for (const price of [{ priceMinor: 420_000 }, { currency: 'EUR' }, { priceMinor: 420_000, currency: 'JPY' }, { priceMinor: -1, currency: 'EUR' }, { priceMinor: 100_000_001, currency: 'EUR' }, { priceMinor: 4.5, currency: 'EUR' }]) {
      expect(errorOf(await operator.post('/api/admin/drops', { ...body, ...price })).code, JSON.stringify(price)).toBe('VALIDATION_FAILED');
    }
    const unpriced = safeJson(await operator.post('/api/admin/drops', body)) as { id: string; priceMinor: number | null; currency: string | null; model: { variant: string | null } };
    expect([unpriced.priceMinor, unpriced.currency, unpriced.model.variant]).toEqual([null, null, 'Blue']);
    const created = await operator.post('/api/admin/drops', { ...body, priceMinor: 420_000, currency: 'EUR' });
    expect(created.statusCode, created.body).toBe(201);
    const d = safeJson(created) as { id: string; priceMinor: number | null; currency: string | null };
    expect([d.priceMinor, d.currency]).toEqual([420_000, 'EUR']);
    expect((await h.ctx.db.selectFrom('audit_logs').select('details').where('action', '=', 'drop.create').where('target_id', '=', d.id).executeTakeFirstOrThrow()).details).toMatchObject({ priceMinor: 420_000, currency: 'EUR' });
    // A DRAFT's price changes, audited, and clears with both.
    const changed = safeJson(await operator.patch(`/api/admin/drops/${d.id}`, { priceMinor: 450_000, currency: 'CHF' })) as { priceMinor: number; currency: string };
    expect([changed.priceMinor, changed.currency]).toEqual([450_000, 'CHF']);
    expect((await h.ctx.db.selectFrom('audit_logs').select('details').where('action', '=', 'drop.update').where('target_id', '=', d.id).executeTakeFirstOrThrow()).details).toEqual({
      before: { priceMinor: 420_000, currency: 'EUR' },
      after: { priceMinor: 450_000, currency: 'CHF' },
    });
    expect(errorOf(await operator.patch(`/api/admin/drops/${d.id}`, { priceMinor: 450_000 })).code).toBe('VALIDATION_FAILED');
    const cleared = safeJson(await operator.patch(`/api/admin/drops/${unpriced.id}`, { priceMinor: null, currency: null })) as { priceMinor: number | null };
    expect(cleared.priceMinor).toBeNull();
    expect((await operator.patch(`/api/admin/drops/${d.id}`, { priceMinor: 420_000, currency: 'EUR' })).statusCode).toBe(200);
    expect((await operator.post(`/api/admin/drops/${d.id}/publish`)).statusCode).toBe(200);
    // Published: fixed.
    const locked = await operator.patch(`/api/admin/drops/${d.id}`, { priceMinor: 1, currency: 'EUR' });
    expect([locked.statusCode, errorOf(locked).code]).toEqual([409, 'DROP_PUBLISHED']);
    // Its card and page say it, with the model's variant.
    const card = (safeJson(await h.client().get('/api/v1/drops')) as { drops: { id: string; priceMinor: number | null; currency: string | null; model: { variant: string | null } }[] }).drops.find((x) => x.id === d.id)!;
    expect(card).toMatchObject({ priceMinor: 420_000, currency: 'EUR', model: { variant: 'Blue' } });
    expect(safeJson(await h.client().get(`/api/v1/drops/${d.id}`))).toMatchObject({ priceMinor: 420_000, currency: 'EUR' });

    // An entry drawn and confirmed: its order is priced as the draw (no « to be confirmed »), its size still to enter.
    const { client, email } = await accountClient(h);
    const accountId = (await h.ctx.db.selectFrom('accounts').select('id').where('email', '=', email).executeTakeFirstOrThrow()).id;
    h.clock.advance(HOUR + 60_000);
    await h.ctx.services.drops.enter(accountId, d.id, { type: 'account', id: accountId });
    h.clock.advance(HOUR);
    await h.ctx.services.drops.draw(d.id, actor);
    const entry = await h.ctx.db.selectFrom('drop_entries').select('id').where('drop_id', '=', d.id).executeTakeFirstOrThrow();
    await h.ctx.services.drops.confirm(d.id, entry.id, 'Confirmed by phone.', actor);
    const order = await h.ctx.db.selectFrom('orders').selectAll().where('drop_entry_id', '=', entry.id).executeTakeFirstOrThrow();
    expect([order.channel, order.price_minor, order.currency, order.size_label]).toEqual(['DRAW', 420_000, 'EUR', null]);
    const mine = (safeJson(await client.get('/api/v1/account/orders')) as { orders: { id: string; priceMinor: number | null; currency: string | null; model: string; modelVariant: string | null; size: unknown }[] }).orders;
    expect(mine.find((o) => o.id === order.id)).toMatchObject({ priceMinor: 420_000, currency: 'EUR', model: 'MONOLITHE', modelVariant: 'Blue', size: null });
    // Priced, it is paid without terms entered first (its invoice issued at the draw's price).
    const paid = await h.ctx.services.orders.transition(order.id, { to: 'PAID' }, actor);
    expect([paid.status, paid.priceMinor]).toEqual(['PAID', 420_000]);
  });
});
