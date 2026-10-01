import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import { AuditService } from '../../src/server/services/audit.js';
import { CatalogService } from '../../src/server/services/catalog.js';
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
    expect(c).toEqual({ id: expect.any(String), name: 'ORBITAL', models: 0, createdAt: new Date('2026-04-01T10:00:00.000Z') });
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
});
