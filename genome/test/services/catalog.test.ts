import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import { AuditService } from '../../src/server/services/audit.js';
import { packIdentity } from '../../src/core/identity.js';
import { isGuardViolation } from '../../src/server/db/pg-errors.js';
import { CatalogService, MODEL_IDENTITY_MESSAGE, type ModelRecord, type UpdateModelInput } from '../../src/server/services/catalog.js';
import { CategoryRegistry } from '../../src/server/services/categories.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { addMonthsClamped } from '../../src/server/services/warranty.js';
import { createManualClock, type Actor } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';

const admin: Actor = { type: 'admin', id: 'admin-1', ipHash: 'ip' };

async function domainError(p: Promise<unknown>): Promise<DomainError> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(DomainError);
  return e as DomainError;
}

describe('CatalogService (collections and models)', () => {
  let t: TestDb;
  let audit: AuditService;
  let catalog: CatalogService;
  const clock = createManualClock('2026-04-01T10:00:00.000Z');

  beforeAll(async () => {
    t = await createTestDb();
    audit = new AuditService({ db: t.db, clock: clock.now });
    const categories = new CategoryRegistry({ db: t.db, audit, clock: clock.now });
    await categories.load();
    await categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, admin);
    catalog = new CatalogService({ db: t.db, audit, categories, clock: clock.now });
  });
  afterAll(() => t.close());

  it('creates and lists collections, audited, with unique names', async () => {
    const c = await catalog.createCollection({ name: '  ORBITAL  ' }, admin);
    expect(c).toEqual({ id: expect.any(String), name: 'ORBITAL', models: 0, products: 0, createdAt: new Date('2026-04-01T10:00:00.000Z') });
    expect((await domainError(catalog.createCollection({ name: 'ORBITAL' }, admin))).code).toBe('COLLECTION_EXISTS');
    expect((await domainError(catalog.createCollection({ name: '   ' }, admin))).code).toBe('VALIDATION_FAILED');
    expect((await audit.list({ action: 'collection.create' })).items[0]).toMatchObject({ targetId: c.id, details: { name: 'ORBITAL' } });
    expect((await catalog.listCollections()).map((x) => x.name)).toEqual(['ORBITAL']);
  });

  it('creates models in a category (and optional collection), audited; SKU prefixes are unique', async () => {
    const [col] = await catalog.listCollections();
    const m = await catalog.createModel(
      { categoryCode: 'j', collectionId: col.id, name: 'MONOLITHE', type: 'RING', skuPrefix: 'mnl-rg', defaultMaterial: '925 STERLING SILVER' },
      admin,
    );
    expect(m).toMatchObject({
      name: 'MONOLITHE',
      type: 'RING',
      skuPrefix: 'MNL-RG',
      category: { index: 1, code: 'J', name: 'Jewelry' },
      collection: { id: col.id, name: 'ORBITAL' },
      defaultMaterial: '925 STERLING SILVER',
      careInstructions: null,
      active: true,
      products: 0,
    });
    expect(await catalog.getModel(m.id)).toEqual(m);
    expect((await catalog.listCollections())[0].models).toBe(1);
    expect((await domainError(catalog.createModel({ categoryCode: 'J', name: 'X', type: 'RING', skuPrefix: 'MNL-RG' }, admin))).code).toBe('SKU_PREFIX_TAKEN');
    expect((await domainError(catalog.createModel({ categoryCode: 'Q', name: 'X', type: 'RING', skuPrefix: 'Q1' }, admin))).code).toBe('CATEGORY_NOT_FOUND');
    expect(
      (await domainError(catalog.createModel({ categoryCode: 'J', collectionId: '00000000-0000-4000-8000-000000000000', name: 'X', type: 'RING', skuPrefix: 'Q2' }, admin))).code,
    ).toBe('COLLECTION_NOT_FOUND');
    expect((await audit.list({ action: 'model.create' })).items[0]).toMatchObject({ targetId: m.id, details: { skuPrefix: 'MNL-RG', category: 'J' } });
    expect((await catalog.listModels()).map((x) => x.id)).toEqual([m.id]);
    expect((await domainError(catalog.getModel('00000000-0000-4000-8000-000000000000'))).code).toBe('MODEL_NOT_FOUND');
  });

  describe('edits (A-10)', () => {
    let model: ModelRecord;
    let orbital: string;
    let eclipse: string;

    beforeAll(async () => {
      orbital = (await catalog.listCollections()).find((c) => c.name === 'ORBITAL')!.id;
      eclipse = (await catalog.createCollection({ name: 'ECLIPSE' }, admin)).id;
      model = await catalog.createModel(
        { categoryCode: 'J', collectionId: orbital, name: 'HALO', type: 'RING', skuPrefix: 'HAL-RG', defaultMaterial: '925 STERLING SILVER', careInstructions: 'Polish gently.' },
        admin,
      );
      // Two pieces issued with HALO: one in the model's collection, one in a collection of its own.
      const piece = (serial: number, collectionId: string | null) =>
        t.db
          .insertInto('products')
          .values({
            product_id: `O26-J-${String(serial).padStart(5, '0')}`,
            packed_identity: packIdentity({ year: 2026, categoryIndex: 1, serial }),
            year: 2026,
            category_id: 1,
            serial,
            sku: `HAL-RG-${serial}`,
            model_id: model.id,
            collection_id: collectionId,
            material: '925 STERLING SILVER',
          })
          .execute();
      await piece(1, null);
      await piece(2, eclipse);
    });

    it('counts the pieces a change reaches: issued with the model, or shown in the collection (their own, else their model\'s)', async () => {
      expect((await catalog.getModel(model.id)).products).toBe(2);
      const cols = Object.fromEntries((await catalog.listCollections()).map((c) => [c.name, c]));
      expect(cols.ORBITAL).toMatchObject({ models: 2, products: 1 });
      expect(cols.ECLIPSE).toMatchObject({ models: 0, products: 1 });
      expect(await catalog.getCollection(eclipse)).toEqual(cols.ECLIPSE);
    });

    it('changes a model\'s name, material, care, collection and active, audited with the fields before and after', async () => {
      clock.advance(60_000);
      const updated = await catalog.updateModel(
        model.id,
        { name: ' HALO II ', defaultMaterial: '', careInstructions: 'Wipe with a soft, dry cloth.\nStore it on its own.', collectionId: eclipse, active: false },
        admin,
      );
      expect(updated).toMatchObject({
        id: model.id,
        name: 'HALO II',
        type: 'RING',
        skuPrefix: 'HAL-RG',
        category: { code: 'J' },
        collection: { id: eclipse, name: 'ECLIPSE' },
        defaultMaterial: null,
        careInstructions: 'Wipe with a soft, dry cloth.\nStore it on its own.',
        active: false,
        products: 2,
      });
      const [entry] = (await audit.list({ action: 'model.update' })).items;
      expect(entry).toMatchObject({ actorId: 'admin-1', targetType: 'model', targetId: model.id });
      expect(entry.details).toEqual({
        before: { name: 'HALO', defaultMaterial: '925 STERLING SILVER', careInstructions: 'Polish gently.', collectionId: orbital, active: true },
        after: { name: 'HALO II', defaultMaterial: null, careInstructions: 'Wipe with a soft, dry cloth.\nStore it on its own.', collectionId: eclipse, active: false },
        issuedPieces: 2,
      });

      // Only what changed is recorded; a change that changes nothing writes nothing.
      await catalog.updateModel(model.id, { name: 'HALO II', active: true }, admin);
      const entries = (await audit.list({ action: 'model.update' })).items;
      expect(entries).toHaveLength(2);
      expect(entries[0].details).toEqual({ before: { active: false }, after: { active: true }, issuedPieces: 2 });
      await catalog.updateModel(model.id, { name: 'HALO II', careInstructions: ' Wipe with a soft, dry cloth.\nStore it on its own. ', collectionId: eclipse.toUpperCase() }, admin);
      expect((await audit.list({ action: 'model.update' })).items).toHaveLength(2);

      // The collection is cleared with null (or '').
      expect((await catalog.updateModel(model.id, { collectionId: null }, admin)).collection).toBeNull();
      expect((await catalog.updateModel(model.id, { collectionId: orbital }, admin)).collection).toEqual({ id: orbital, name: 'ORBITAL' });
    });

    it('never changes a model\'s category nor its SKU prefix: a forbidden field is a 400, and nothing is written', async () => {
      const before = await catalog.getModel(model.id);
      const audited = (await audit.list({ action: 'model.update' })).items.length;
      for (const forbidden of [{ skuPrefix: 'NEW-RG' }, { categoryCode: 'L' }, { category: 'L' }, { name: 'X', skuPrefix: 'HAL-RG' }]) {
        const e = await domainError(catalog.updateModel(model.id, forbidden as UpdateModelInput, admin));
        expect(e.httpStatus, JSON.stringify(forbidden)).toBe(400);
        expect(e.code).toBe('VALIDATION_FAILED');
        expect(e.message).toBe(MODEL_IDENTITY_MESSAGE);
      }
      for (const bad of [{ type: 'PENDANT' }, { createdAt: '2020-01-01' }, {}, { name: '   ' }, { name: 'x'.repeat(101) }, { careInstructions: 'x'.repeat(2001) }, { active: 'no' }]) {
        const e = await domainError(catalog.updateModel(model.id, bad as unknown as UpdateModelInput, admin));
        expect([e.httpStatus, e.code], JSON.stringify(bad)).toEqual([400, 'VALIDATION_FAILED']);
      }
      expect((await domainError(catalog.updateModel(model.id, { collectionId: '00000000-0000-4000-8000-000000000000' }, admin))).code).toBe('COLLECTION_NOT_FOUND');
      expect((await domainError(catalog.updateModel('00000000-0000-4000-8000-000000000000', { name: 'X' }, admin))).code).toBe('MODEL_NOT_FOUND');
      expect((await domainError(catalog.updateModel('not-a-uuid', { name: 'X' }, admin))).code).toBe('MODEL_NOT_FOUND');
      expect(await catalog.getModel(model.id)).toEqual(before);
      expect((await audit.list({ action: 'model.update' })).items).toHaveLength(audited);
      // Below the service, the database refuses them too.
      await expect(t.db.updateTable('models').set({ sku_prefix: 'NEW-RG' }).where('id', '=', model.id).execute()).rejects.toSatisfy(isGuardViolation);
    });

    it('sets a model\'s base price with its currency and its care guide (plan LIVE RELEASE+, N2 and M6), audited, the guide as its fingerprint', async () => {
      clock.advance(60_000);
      const fresh = await catalog.getModel(model.id);
      expect([fresh.basePriceMinor, fresh.baseCurrency, fresh.careGuide]).toEqual([null, null, null]);
      expect(fresh.shopify).toEqual({ productId: null, variants: 1, linked: 0 });
      const guide = 'Wipe it with a soft cloth.   \r\n\r\n\r\n\r\nKeep it in its box.';
      const updated = await catalog.updateModel(model.id, { basePriceMinor: 480_050, baseCurrency: 'EUR', careGuide: guide }, admin);
      expect([updated.basePriceMinor, updated.baseCurrency, updated.careGuide]).toEqual([480_050, 'EUR', 'Wipe it with a soft cloth.\n\nKeep it in its box.']);
      const [entry] = (await audit.list({ action: 'model.update' })).items;
      expect(entry.details).toEqual({
        before: { basePriceMinor: null, baseCurrency: null, careGuide: null },
        after: { basePriceMinor: 480_050, baseCurrency: 'EUR', careGuide: { length: 'Wipe it with a soft cloth.\n\nKeep it in its box.'.length, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) } },
        issuedPieces: 2,
      });
      expect(JSON.stringify(entry.details)).not.toContain('Keep it');
      // The currency alone changes; the same again writes nothing; null clears both.
      expect((await catalog.updateModel(model.id, { basePriceMinor: 480_050, baseCurrency: 'CHF' }, admin)).baseCurrency).toBe('CHF');
      const audited = (await audit.list({ action: 'model.update' })).items.length;
      await catalog.updateModel(model.id, { basePriceMinor: 480_050, baseCurrency: 'CHF', careGuide: 'Wipe it with a soft cloth.\n\nKeep it in its box.' }, admin);
      expect((await audit.list({ action: 'model.update' })).items).toHaveLength(audited);
      const cleared = await catalog.updateModel(model.id, { basePriceMinor: null, baseCurrency: null, careGuide: '' }, admin);
      expect([cleared.basePriceMinor, cleared.baseCurrency, cleared.careGuide]).toEqual([null, null, null]);
      for (const bad of [
        { basePriceMinor: 480_000 },
        { baseCurrency: 'EUR' },
        { basePriceMinor: 480_000, baseCurrency: null },
        { basePriceMinor: 0, baseCurrency: 'EUR' },
        { basePriceMinor: 12.5, baseCurrency: 'EUR' },
        { basePriceMinor: 100_000_001, baseCurrency: 'EUR' },
        { basePriceMinor: 480_000, baseCurrency: 'JPY' },
        { careGuide: 'x'.repeat(8001) },
        { careGuide: 'bell\u0007' },
      ]) {
        const e = await domainError(catalog.updateModel(model.id, bad as unknown as UpdateModelInput, admin));
        expect([e.httpStatus, e.code], JSON.stringify(bad)).toEqual([400, 'VALIDATION_FAILED']);
      }
    });

    it('discontinues a model (P-R06): inactive in the same transaction, dated, audited; reinstated, active again; never active while discontinued', async () => {
      clock.advance(60_000);
      const before = await catalog.getModel(model.id);
      expect(before).toMatchObject({ active: true, discontinuedAt: null });
      const off = await catalog.discontinueModel(model.id.toUpperCase(), admin);
      expect(off).toMatchObject({ id: model.id, active: false, discontinuedAt: clock.now() });
      // A script (an actor that is no console user's uuid) leaves no author.
      expect((await t.db.selectFrom('models').select(['discontinued_by', 'active']).where('id', '=', model.id).executeTakeFirstOrThrow())).toEqual({ discontinued_by: null, active: false });
      const [entry] = (await audit.list({ action: 'model.discontinue' })).items;
      expect(entry).toMatchObject({ actorId: 'admin-1', targetType: 'model', targetId: model.id });
      expect(entry.details).toEqual({ name: before.name, skuPrefix: 'HAL-RG', discontinuedAt: clock.now().toISOString(), wasActive: true, issuedPieces: 2 });
      // Once: again is a 409, and nothing more is written.
      expect((await domainError(catalog.discontinueModel(model.id, admin))).code).toBe('MODEL_ALREADY_DISCONTINUED');
      expect((await audit.list({ action: 'model.discontinue' })).items).toHaveLength(1);
      // An edit never makes it active (409, nothing written); its other fields still change; inactive again is no change.
      const audited = (await audit.list({ action: 'model.update' })).items.length;
      const refused = await domainError(catalog.updateModel(model.id, { active: true, name: 'HALO III' }, admin));
      expect([refused.httpStatus, refused.code]).toEqual([409, 'MODEL_DISCONTINUED']);
      expect((await catalog.getModel(model.id)).name).toBe(before.name);
      expect((await catalog.updateModel(model.id, { active: false, defaultMaterial: '18K GOLD' }, admin))).toMatchObject({ active: false, defaultMaterial: '18K GOLD', discontinuedAt: clock.now() });
      expect((await audit.list({ action: 'model.update' })).items).toHaveLength(audited + 1);

      clock.advance(60_000);
      const on = await catalog.reinstateModel(model.id, admin);
      expect(on).toMatchObject({ active: true, discontinuedAt: null });
      const [back] = (await audit.list({ action: 'model.reinstate' })).items;
      expect(back.details).toEqual({ name: before.name, skuPrefix: 'HAL-RG', discontinuedAt: new Date(clock.now().getTime() - 60_000).toISOString(), issuedPieces: 2 });
      expect((await domainError(catalog.reinstateModel(model.id, admin))).code).toBe('MODEL_NOT_DISCONTINUED');
      // An inactive model discontinued stays inactive; reinstated, it is active (offered again).
      await catalog.updateModel(model.id, { active: false }, admin);
      expect((await audit.list({ action: 'model.discontinue' })).items.length).toBe(1);
      await catalog.discontinueModel(model.id, admin);
      expect((await audit.list({ action: 'model.discontinue' })).items[0].details).toMatchObject({ wasActive: false });
      expect(await catalog.reinstateModel(model.id, admin)).toMatchObject({ active: true, discontinuedAt: null });
      for (const id of ['00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
        expect((await domainError(catalog.discontinueModel(id, admin))).code).toBe('MODEL_NOT_FOUND');
        expect((await domainError(catalog.reinstateModel(id, admin))).code).toBe('MODEL_NOT_FOUND');
      }
      await catalog.updateModel(model.id, { defaultMaterial: before.defaultMaterial }, admin);
    });

    it('renames a collection, audited with the name before and after and the pieces it is shown on', async () => {
      clock.advance(60_000);
      const renamed = await catalog.updateCollection(eclipse, { name: ' ECLIPSE NOIRE ' }, admin);
      expect(renamed).toMatchObject({ id: eclipse, name: 'ECLIPSE NOIRE', products: 1 });
      const [entry] = (await audit.list({ action: 'collection.update' })).items;
      expect(entry).toMatchObject({ targetType: 'collection', targetId: eclipse, details: { before: { name: 'ECLIPSE' }, after: { name: 'ECLIPSE NOIRE' }, issuedPieces: 1 } });
      // The same name again writes nothing; another collection's name, an unknown collection and a blank name are refused.
      await catalog.updateCollection(eclipse, { name: 'ECLIPSE NOIRE' }, admin);
      expect((await audit.list({ action: 'collection.update' })).items).toHaveLength(1);
      expect((await domainError(catalog.updateCollection(eclipse, { name: 'ORBITAL' }, admin))).code).toBe('COLLECTION_EXISTS');
      expect((await domainError(catalog.updateCollection('00000000-0000-4000-8000-000000000000', { name: 'X' }, admin))).code).toBe('COLLECTION_NOT_FOUND');
      expect((await domainError(catalog.updateCollection(eclipse, { name: '  ' }, admin))).code).toBe('VALIDATION_FAILED');
      expect((await catalog.getCollection(eclipse)).name).toBe('ECLIPSE NOIRE');
    });
  });

  it('gives a new model its size type (NEXT LOT §3.3 item 6b): its kind derived, ONE SIZE declared at once for a watch or a model of one size, none for a ring; model.create carries it', async () => {
    const watch = await catalog.createModel({ categoryCode: 'J', name: 'SOLSTICE', type: 'AUTOMATIC WATCH', skuPrefix: 'SOL-WT', sizeType: 'WATCH' }, admin);
    expect(watch).toMatchObject({ sizeType: 'WATCH', sizesOffered: 1 });
    const one = await catalog.createModel({ categoryCode: 'J', name: 'NOCTURNE', type: 'FRAGRANCE', skuPrefix: 'NOC-FR', sizeType: 'ONE_SIZE' }, admin);
    expect(one).toMatchObject({ sizeType: 'ONE_SIZE', sizesOffered: 1 });
    const ring = await catalog.createModel({ categoryCode: 'J', name: 'ORBITE', type: 'RING', skuPrefix: 'ORB-RG', sizeType: 'RING' }, admin);
    expect(ring).toMatchObject({ sizeType: 'RING', sizesOffered: 0 });
    const rows = await t.db.selectFrom('models as m').leftJoin('skus as k', 'k.model_id', 'm.id').select(['m.sku_prefix', 'm.size_type', 'm.size_kind', 'k.code', 'k.size_label']).where('m.id', 'in', [watch.id, one.id, ring.id]).orderBy('m.sku_prefix').execute();
    expect(rows).toEqual([
      { sku_prefix: 'NOC-FR', size_type: 'ONE_SIZE', size_kind: null, code: 'NOC-FR', size_label: null },
      { sku_prefix: 'ORB-RG', size_type: 'RING', size_kind: 'RING', code: null, size_label: null },
      { sku_prefix: 'SOL-WT', size_type: 'WATCH', size_kind: 'WRIST', code: 'SOL-WT', size_label: null },
    ]);
    const created = (await audit.list({ action: 'model.create' })).items.filter((e) => [watch.id, one.id, ring.id].includes(e.targetId!));
    expect(created.map((e) => (e.details as { sizeType?: string }).sizeType).sort()).toEqual(['ONE_SIZE', 'RING', 'WATCH']);
    // Without one (a fixture, the demo's seed): no type, as a model of before H1.
    const typeless = await catalog.createModel({ categoryCode: 'J', name: 'AURORE', type: 'PENDANT', skuPrefix: 'AUR-PD' }, admin);
    expect(typeless).toMatchObject({ sizeType: null, sizesOffered: 0 });
    expect((await audit.list({ action: 'model.create', targetId: typeless.id })).items[0]!.details).not.toHaveProperty('sizeType');
    expect((await domainError(catalog.createModel({ categoryCode: 'J', name: 'X', type: 'RING', skuPrefix: 'X-WR', sizeType: 'WRIST' as never }, admin))).publicMessage).toBe('Give the model its size type.');
  });

  it('copies a main model\'s offered sizes to its new variant (NEXT LOT §3.3): a typeless main as they are, the variant typeless too unless given a type; a size set aside never', async () => {
    const main = await catalog.createModel({ categoryCode: 'J', name: 'ECLIPSE', type: 'RING', skuPrefix: 'ECL-RG' }, admin);
    for (const label of ['SIZE 52', '54', null]) await ensureSku(t.db, main.id, label);
    await t.db.updateTable('skus').set({ set_aside_at: clock.now(), fit_min_mm: null }).where('model_id', '=', main.id).where('size_label', '=', '54').execute();
    await t.db.updateTable('skus').set({ fit_min_mm: 51, fit_max_mm: 53 }).where('model_id', '=', main.id).where('size_label', '=', 'SIZE 52').execute();
    const blue = await catalog.createVariant(main.id, { label: 'Blue', swatch: '#16224A', skuPrefix: 'ECL-BL', mainLabel: 'Silver', mainSwatch: '#D7D5D0' }, admin);
    expect(blue).toMatchObject({ sizeType: null, sizesOffered: 2 });
    expect(await t.db.selectFrom('skus').select(['code', 'size_label', 'fit_min_mm', 'fit_max_mm', 'set_aside_at']).where('model_id', '=', blue.id).orderBy('code').execute()).toEqual([
      { code: 'ECL-BL', size_label: null, fit_min_mm: null, fit_max_mm: null, set_aside_at: null },
      { code: 'ECL-BL-SIZE-52', size_label: 'SIZE 52', fit_min_mm: 51, fit_max_mm: 53, set_aside_at: null },
    ]);
    const created = (await audit.list({ action: 'model.variant.create', targetId: blue.id })).items[0]!.details as Record<string, unknown>;
    expect(created).toMatchObject({ copied: ['type', 'collection', 'story', 'specs', 'care', 'sizes', 'warranty'], sizes: ['ONE SIZE', 'SIZE 52'] });
    expect(created).not.toHaveProperty('sizeType');
    // The route's rule: a variant of a typeless main is given its type (400 otherwise); a typed main's is copied.
    expect((await domainError(catalog.createVariant(main.id, { label: 'Gold', swatch: '#B88A3A', skuPrefix: 'ECL-GD' }, admin, { requireSizeType: true }))).publicMessage).toBe('Give the model its size type.');
    const gold = await catalog.createVariant(main.id, { label: 'Gold', swatch: '#B88A3A', skuPrefix: 'ECL-GD', sizeType: 'RING' }, admin, { requireSizeType: true });
    expect(gold).toMatchObject({ sizeType: 'RING', sizesOffered: 2 });
    expect((await t.db.selectFrom('models').select(['size_type', 'size_kind']).where('id', '=', main.id).executeTakeFirstOrThrow())).toEqual({ size_type: null, size_kind: null });
    const typed = await catalog.createModel({ categoryCode: 'J', name: 'ZENITH', type: 'BANGLE', skuPrefix: 'ZEN-BG', sizeType: 'BRACELET' }, admin);
    await t.db.updateTable('models').set({ variant_label: 'Steel', variant_swatch: '#9D9B96' }).where('id', '=', typed.id).execute();
    expect((await domainError(catalog.createVariant(typed.id, { label: 'Gold', swatch: '#B88A3A', skuPrefix: 'ZEN-GD', sizeType: 'RING' }, admin))).publicMessage).toBe('This model has its size type: its variant copies it.');
    expect(await catalog.createVariant(typed.id, { label: 'Gold', swatch: '#B88A3A', skuPrefix: 'ZEN-GD' }, admin, { requireSizeType: true })).toMatchObject({ sizeType: 'BRACELET', sizesOffered: 0 });
  });
});

describe('a model’s warranty (plan ORBES CARE, answer 12, D16, D17)', () => {
  let t: TestDb;
  let audit: AuditService;
  let catalog: CatalogService;
  let serial = 0;
  const clock = createManualClock('2026-10-15T10:00:00.000Z');

  beforeAll(async () => {
    t = await createTestDb();
    audit = new AuditService({ db: t.db, clock: clock.now });
    const categories = new CategoryRegistry({ db: t.db, audit, clock: clock.now });
    await categories.load();
    await categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, admin);
    catalog = new CatalogService({ db: t.db, audit, categories, clock: clock.now });
  });
  afterAll(() => t.close());

  /** A piece of `modelId` with its warranty row as given. */
  async function piece(modelId: string, warranty: { start_date?: string | null; duration_months?: number; end_date?: string | null; lifetime: boolean; voided_at?: Date | null }) {
    const s = ++serial;
    const p = await t.db
      .insertInto('products')
      .values({ product_id: `O26-J-${String(s).padStart(5, '0')}`, packed_identity: packIdentity({ year: 2026, categoryIndex: 1, serial: s }), year: 2026, category_id: 1, serial: s, sku: `W-${s}`, model_id: modelId, material: '925 STERLING SILVER' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.db.insertInto('warranties').values({ product_id: p.id, duration_months: 24, ...warranty }).execute();
    return p.id;
  }
  const rowOf = (productId: string) =>
    t.db.selectFrom('warranties').select(['lifetime', 'start_date', 'end_date', 'duration_months', 'voided_at']).where('product_id', '=', productId).executeTakeFirstOrThrow();

  it('a new model is Lifetime unless created at 2 years; model.create says which', async () => {
    const life = await catalog.createModel({ categoryCode: 'J', name: 'HALO', type: 'RING', skuPrefix: 'HAL-RG' }, admin);
    expect(life).toMatchObject({ warrantyLifetime: true, soldPieces: 0 });
    expect((await t.db.selectFrom('models').select('warranty_lifetime').where('id', '=', life.id).executeTakeFirstOrThrow()).warranty_lifetime).toBe(true);
    expect((await audit.list({ action: 'model.create', targetId: life.id })).items[0]!.details).toMatchObject({ warrantyLifetime: true });
    const two = await catalog.createModel({ categoryCode: 'J', name: 'ATLAS', type: 'WALLET', skuPrefix: 'ATL-WL', warrantyLifetime: false }, admin);
    expect(two.warrantyLifetime).toBe(false);
    expect((await audit.list({ action: 'model.create', targetId: two.id })).items[0]!.details).toMatchObject({ warrantyLifetime: false });
    expect((await domainError(catalog.createModel({ categoryCode: 'J', name: 'X', type: 'RING', skuPrefix: 'X-1', warrantyLifetime: 'yes' as never }, admin))).code).toBe('VALIDATION_FAILED');
    expect((await catalog.listModels()).map((m) => [m.name, m.warrantyLifetime])).toEqual([
      ['ATLAS', false],
      ['HALO', true],
    ]);
  });

  it('ADD A VARIANT copies its main model’s warranty, then keeps its own', async () => {
    const two = await catalog.createModel({ categoryCode: 'J', name: 'CARRY', type: 'BAG', skuPrefix: 'CRY-BG', warrantyLifetime: false }, admin);
    const tan = await catalog.createVariant(two.id, { label: 'Tan', swatch: '#A0704A', skuPrefix: 'CRY-TN', mainLabel: 'Black', mainSwatch: '#111111' }, admin);
    expect(tan.warrantyLifetime).toBe(false);
    const life = await catalog.createModel({ categoryCode: 'J', name: 'ORBIT', type: 'RING', skuPrefix: 'ORB-RG' }, admin);
    const gold = await catalog.createVariant(life.id, { label: 'Gold', swatch: '#B88A3A', skuPrefix: 'ORB-GD', mainLabel: 'Silver', mainSwatch: '#D7D5D0' }, admin);
    expect(gold.warrantyLifetime).toBe(true);
    expect((await audit.list({ action: 'model.variant.create', targetId: gold.id })).items[0]!.details).toMatchObject({ copied: expect.arrayContaining(['warranty']) });
    // Afterwards, each its own row: the main model's change does not reach its variant.
    await catalog.setWarranty(life.id, false, admin);
    expect((await catalog.getModel(gold.id)).warrantyLifetime).toBe(true);
  });

  it('the edit never takes it: 400 with the service’s own words, nothing written', async () => {
    const m = await catalog.createModel({ categoryCode: 'J', name: 'NOVA', type: 'RING', skuPrefix: 'NOV-RG' }, admin);
    const e = await domainError(catalog.updateModel(m.id, { warrantyLifetime: false } as unknown as UpdateModelInput, admin));
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.publicMessage).toBe('A model has no field warrantyLifetime to change.');
    expect((await catalog.getModel(m.id)).warrantyLifetime).toBe(true);
  });

  it('to 2 years: each started piece gets start + its own months (EXPIRED when past, an extension kept, clamped, never before the start); not started, only the kind; VOID untouched; audited with its counts', async () => {
    const m = await catalog.createModel({ categoryCode: 'J', name: 'LUNA', type: 'RING', skuPrefix: 'LUN-RG' }, admin);
    const recent = await piece(m.id, { start_date: '2026-06-01', lifetime: true });
    const old = await piece(m.id, { start_date: '2023-01-10', lifetime: true });
    const extended = await piece(m.id, { start_date: '2025-08-31', duration_months: 30, lifetime: true });
    const clamped = await piece(m.id, { start_date: '2026-01-31', duration_months: 25, lifetime: true });
    const zero = await piece(m.id, { start_date: '2026-06-01', duration_months: 0, lifetime: true });
    const notStarted = await piece(m.id, { lifetime: true });
    const voided = await piece(m.id, { start_date: '2026-03-01', lifetime: true, voided_at: new Date('2026-04-01T00:00:00.000Z') });
    expect((await catalog.getModel(m.id)).soldPieces).toBe(5);

    const r = await catalog.setWarranty(m.id, false, admin);
    expect(r).toMatchObject({ id: m.id, warrantyLifetime: false, soldPieces: 5 });
    expect(await rowOf(recent)).toMatchObject({ lifetime: false, end_date: '2028-06-01', duration_months: 24 });
    expect(await rowOf(old)).toMatchObject({ lifetime: false, end_date: '2025-01-10' });
    expect(await rowOf(extended)).toMatchObject({ lifetime: false, end_date: addMonthsClamped('2025-08-31', 30), duration_months: 30 });
    expect((await rowOf(extended)).end_date).toBe('2028-02-29');
    expect(await rowOf(clamped)).toMatchObject({ lifetime: false, end_date: addMonthsClamped('2026-01-31', 25) });
    expect((await rowOf(clamped)).end_date).toBe('2028-02-29');
    expect(await rowOf(zero)).toMatchObject({ lifetime: false, end_date: '2026-06-01' });
    expect(await rowOf(notStarted)).toMatchObject({ lifetime: false, start_date: null, end_date: null });
    expect(await rowOf(voided)).toMatchObject({ lifetime: true, end_date: null, start_date: '2026-03-01' });
    const entry = (await audit.list({ action: 'model.warranty', targetId: m.id })).items[0]!;
    expect(entry).toMatchObject({ actorType: 'admin', actorId: admin.id, targetType: 'model' });
    // Changed: the six not VOID; started: five; past their new end: the old one and the 0-month one.
    expect(entry.details).toEqual({ before: { warrantyLifetime: true }, after: { warrantyLifetime: false }, pieces: 6, sold: 5, nowExpired: 2 });

    // The same choice again writes and audits nothing.
    await catalog.setWarranty(m.id, false, admin);
    expect((await audit.list({ action: 'model.warranty', targetId: m.id })).total).toBe(1);

    // Back to lifetime: every end date cleared, the EXPIRED ones ACTIVE again; the months kept; VOID untouched.
    await catalog.setWarranty(m.id, true, admin);
    for (const id of [recent, old, extended, clamped, zero, notStarted]) expect(await rowOf(id)).toMatchObject({ lifetime: true, end_date: null });
    expect((await rowOf(extended)).duration_months).toBe(30);
    expect((await audit.list({ action: 'model.warranty', targetId: m.id })).items[0]!.details).toEqual({
      before: { warrantyLifetime: false },
      after: { warrantyLifetime: true },
      pieces: 6,
      sold: 5,
      nowExpired: 0,
    });
    // And to 2 years once more: the same end dates as the first time (D17).
    await catalog.setWarranty(m.id, false, admin);
    expect((await rowOf(old)).end_date).toBe('2025-01-10');
    expect((await rowOf(extended)).end_date).toBe('2028-02-29');
  });

  it('counts its pieces sold (started, not VOID), as products counts its pieces issued', async () => {
    const m = await catalog.createModel({ categoryCode: 'J', name: 'SOL', type: 'RING', skuPrefix: 'SOL-RG' }, admin);
    await piece(m.id, { start_date: '2026-06-01', lifetime: true });
    await piece(m.id, { lifetime: true });
    await piece(m.id, { start_date: '2026-06-01', lifetime: true, voided_at: clock.now() });
    expect(await catalog.getModel(m.id)).toMatchObject({ products: 3, soldPieces: 1 });
    expect((await catalog.listModels()).find((x) => x.id === m.id)).toMatchObject({ products: 3, soldPieces: 1 });
  });

  it('refuses an unknown model (404) and a choice that is not a boolean (400)', async () => {
    expect((await domainError(catalog.setWarranty('00000000-0000-4000-8000-000000000000', false, admin))).code).toBe('MODEL_NOT_FOUND');
    const m = await catalog.createModel({ categoryCode: 'J', name: 'VEGA', type: 'RING', skuPrefix: 'VEG-RG' }, admin);
    expect((await domainError(catalog.setWarranty(m.id, 'no' as never, admin))).code).toBe('VALIDATION_FAILED');
  });
});

describe('a model’s packing (plan MACRO M3 §1.2, B1 and B2)', () => {
  let t: TestDb;
  let audit: AuditService;
  let catalog: CatalogService;
  const clock = createManualClock('2026-10-22T10:00:00.000Z');

  beforeAll(async () => {
    t = await createTestDb();
    audit = new AuditService({ db: t.db, clock: clock.now });
    const categories = new CategoryRegistry({ db: t.db, audit, clock: clock.now });
    await categories.load();
    await categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, admin);
    catalog = new CatalogService({ db: t.db, audit, categories, clock: clock.now });
  });
  afterAll(() => t.close());

  const box = async (name: string, active = true) =>
    (await t.db.insertInto('boxes').values({ name, inside_length_mm: 100, inside_width_mm: 70, inside_height_mm: 40, empty_weight_g: 120, cost_minor: 85, currency: 'EUR', active }).returning('id').executeTakeFirstOrThrow()).id;
  const ref = (id: string, name: string, active = true) => ({ id, name, insideLengthMm: 100, insideWidthMm: 70, insideHeightMm: 40, emptyWeightG: 120, active });

  it('sets a model’s box and packed weight, read with the model and in the list, never its cost; audited model.packing; nothing changed, nothing written', async () => {
    const cube = await box('CUBE');
    const m = await catalog.createModel({ categoryCode: 'J', name: 'HALO', type: 'RING', skuPrefix: 'HAL-RG' }, admin);
    expect(m.packing).toEqual({ box: null, packedWeightG: null, inherited: null });
    const set = await catalog.setModelPacking(m.id, { boxId: cube, packedWeightG: 85 }, admin);
    expect(set.packing).toEqual({ box: ref(cube, 'CUBE'), packedWeightG: 85, inherited: null });
    expect(JSON.stringify(set.packing)).not.toContain('cost');
    expect((await catalog.listModels()).find((x) => x.id === m.id)!.packing.box?.name).toBe('CUBE');
    const entries = async () => (await audit.list({ action: 'model.packing', targetId: m.id })).items;
    expect((await entries())[0]).toMatchObject({ details: { before: { boxId: null, packedWeightG: null }, after: { boxId: cube, packedWeightG: 85 } } });
    // One field at a time; the same again writes nothing; null clears.
    expect((await catalog.setModelPacking(m.id, { packedWeightG: 90 }, admin)).packing).toMatchObject({ box: { id: cube }, packedWeightG: 90 });
    await catalog.setModelPacking(m.id, { boxId: cube, packedWeightG: 90 }, admin);
    expect(await entries()).toHaveLength(2);
    expect((await catalog.setModelPacking(m.id, { boxId: null, packedWeightG: null }, admin)).packing).toEqual({ box: null, packedWeightG: null, inherited: null });
  });

  it('refuses a box set aside or unknown, a weight out of 1 to 30 000 g, an unknown model; keeps a box set aside the model already names', async () => {
    const kept = await box('KEPT');
    const aside = await box('ASIDE', false);
    const m = await catalog.createModel({ categoryCode: 'J', name: 'ORBIT', type: 'RING', skuPrefix: 'ORB-RG' }, admin);
    expect(await domainError(catalog.setModelPacking(m.id, { boxId: aside }, admin))).toMatchObject({ code: 'BOX_SET_ASIDE', httpStatus: 409 });
    expect(await domainError(catalog.setModelPacking(m.id, { boxId: '00000000-0000-4000-8000-000000000000' }, admin))).toMatchObject({ code: 'BOX_NOT_FOUND', httpStatus: 404 });
    expect(await domainError(catalog.setModelPacking(m.id, { boxId: 'nope' }, admin))).toMatchObject({ code: 'BOX_NOT_FOUND', httpStatus: 404 });
    for (const w of [0, 30_001, 12.5]) expect((await domainError(catalog.setModelPacking(m.id, { packedWeightG: w }, admin))).code).toBe('VALIDATION_FAILED');
    expect((await domainError(catalog.setModelPacking(m.id, {}, admin))).code).toBe('VALIDATION_FAILED');
    expect((await domainError(catalog.setModelPacking('00000000-0000-4000-8000-000000000000', { packedWeightG: 10 }, admin))).code).toBe('MODEL_NOT_FOUND');
    expect((await catalog.setModelPacking(m.id, { boxId: kept, packedWeightG: 30_000 }, admin)).packing.packedWeightG).toBe(30_000);
    await t.db.updateTable('boxes').set({ active: false }).where('id', '=', kept).execute();
    // Its own box set aside meanwhile: its weight still changes.
    expect((await catalog.setModelPacking(m.id, { boxId: kept, packedWeightG: 1 }, admin)).packing).toEqual({ box: ref(kept, 'KEPT', false), packedWeightG: 1, inherited: null });
  });

  it('a variant without its own box or weight reads its main model’s, named; its own wins, field by field', async () => {
    const cube = await box('MAIN CUBE');
    const tall = await box('VARIANT TALL');
    const main = await catalog.createModel({ categoryCode: 'J', name: 'ECLIPSE', type: 'RING', skuPrefix: 'ECL-RG' }, admin);
    const blue = await catalog.createVariant(main.id, { label: 'Blue', swatch: '#16224A', skuPrefix: 'ECL-BL', mainLabel: 'Silver', mainSwatch: '#D7D5D0' }, admin);
    expect(blue.packing).toEqual({ box: null, packedWeightG: null, inherited: { from: { id: main.id, name: 'ECLIPSE' }, box: false, packedWeightG: false } });
    await catalog.setModelPacking(main.id, { boxId: cube, packedWeightG: 70 }, admin);
    expect((await catalog.getModel(blue.id)).packing).toEqual({ box: ref(cube, 'MAIN CUBE'), packedWeightG: 70, inherited: { from: { id: main.id, name: 'ECLIPSE' }, box: true, packedWeightG: true } });
    await catalog.setModelPacking(blue.id, { boxId: tall, packedWeightG: null }, admin);
    expect((await catalog.getModel(blue.id)).packing).toEqual({ box: ref(tall, 'VARIANT TALL'), packedWeightG: 70, inherited: { from: { id: main.id, name: 'ECLIPSE' }, box: false, packedWeightG: true } });
    // The main model reads only its own.
    expect((await catalog.getModel(main.id)).packing).toEqual({ box: ref(cube, 'MAIN CUBE'), packedWeightG: 70, inherited: null });
    expect((await catalog.listModels()).find((x) => x.id === blue.id)!.packing).toMatchObject({ box: { id: tall }, packedWeightG: 70 });
  });
});
