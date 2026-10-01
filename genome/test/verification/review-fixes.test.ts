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

describe('authentication_events.authenticators default matches what the service writes', () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(() => w.close());

  it("the column default is the object form '{}' (the service always writes an object)", async () => {
    const out = await verify(w, 'not a code');
    const written = await w.t.db.selectFrom('authentication_events').select('authenticators').where('scan_event_id', '=', out.scanId).executeTakeFirstOrThrow();
    expect(written.authenticators).toEqual({ policy: null, results: [] });
    const row = await w.t.db
      .insertInto('authentication_events')
      .values({ scan_event_id: out.scanId, signature_valid: false, genome_check: 'NOT_PROVIDED', state: 'MALFORMED_CODE', reasons: [], risk_score: 0 })
      .returning('authenticators')
      .executeTakeFirstOrThrow();
    expect(row.authenticators).toEqual({});
    expect(Array.isArray(row.authenticators)).toBe(false);
  });
});
