/**
 * Regression tests for defects found in the spec-compliance review
 * (PLATFORM-CONTRACTS.md §1 product_overview / §2.4 VerifyOutcome).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, issue, verify, type World } from './world.js';

describe('public product fields agree with the registry views', () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(() => w.close());

  it("a product without its own collection shows its model's collection (as product_overview does)", async () => {
    const r = await issue(w, { collectionId: undefined });
    expect(r.product.collectionId).toBeNull();
    const overview = await w.t.db.selectFrom('product_overview').select('collection').where('id', '=', r.product.id).executeTakeFirstOrThrow();
    expect(overview.collection).toBe('ORBIT');
    const out = await verify(w, r.code.data);
    expect(out.state).toBe('AUTHENTIC');
    expect(out.product?.collection).toBe('ORBIT');
  });

  it("the product's own collection wins over the model's", async () => {
    const own = await w.t.db.insertInto('collections').values({ name: 'ZENITH' }).returning('id').executeTakeFirstOrThrow();
    const r = await issue(w, { collectionId: own.id });
    const out = await verify(w, r.code.data);
    expect(out.product?.collection).toBe('ZENITH');
  });
});
