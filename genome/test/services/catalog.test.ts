import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import { AuditService } from '../../src/server/services/audit.js';
import { packIdentity } from '../../src/core/identity.js';
import { isGuardViolation } from '../../src/server/db/pg-errors.js';
import { CatalogService, MODEL_IDENTITY_MESSAGE, type ModelRecord, type UpdateModelInput } from '../../src/server/services/catalog.js';
import { CategoryRegistry } from '../../src/server/services/categories.js';
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
});
