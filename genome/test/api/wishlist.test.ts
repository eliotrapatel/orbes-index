/**
 * YOUR WISHLIST's routes (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.2 W.4 and W.13, step 2.3; API §10.26):
 *
 *  - GET /api/v1/account/wishlist: the open wishes, the latest first, and `max: 200`; signed out 401; never stored;
 *  - PUT and DELETE /api/v1/account/wishlist/:slug: no body; the CSRF token and the same origin (403 otherwise); the
 *    shapes, 404 LOOKBOOK_NOT_FOUND and 409 WISHLIST_FULL in their words; DELETE never says whether an address exists;
 *  - the `api` rate group, as the account's other routes;
 *  - nothing about another collector or staff in any reply, and no audit entry.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

describe('YOUR WISHLIST routes (plan CUSTOMER INTELLIGENCE §3.2 W.4)', () => {
  let h: Harness;
  let blue: string;
  let solo: string;
  let hidden: string;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-09T09:00:00.000Z');
    await h.t.db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry' }).onConflict((oc) => oc.doNothing()).execute();
    const main = await model({ name: 'MONOLITHE', label: 'Steel', swatch: '#8A8D8F' });
    blue = (await model({ name: 'MONOLITHE', label: 'Blue', swatch: '#1F3A93', variantOf: main.id })).slug;
    solo = (await model({ name: 'ORBITE', type: 'CUFF' })).slug;
    hidden = (await model({ name: 'HIDDEN', lookbook: 'HIDDEN' })).slug;
  });
  afterAll(() => h?.close());

  async function model(o: { name: string; type?: string; label?: string; swatch?: string; variantOf?: string; lookbook?: 'PUBLIC' | 'HIDDEN' }): Promise<{ id: string; slug: string }> {
    const id = randomUUID();
    const slug = `wl-${id.slice(0, 8)}`;
    await h.t.db
      .insertInto('models')
      .values({
        id, category_id: 1, name: o.name, type: o.type ?? 'RING', sku_prefix: `WL-${id.slice(0, 8)}`, slug, lookbook: o.lookbook ?? 'PUBLIC', published_at: '2026-01-01T00:00:00Z',
        variant_of: o.variantOf ?? null, variant_label: o.label ?? null, variant_swatch: o.label ? (o.swatch ?? '#888888') : null,
      })
      .execute();
    return { id, slug };
  }

  const wish = (c: Client, slug: string, opts = {}) => c.request('PUT', `/api/v1/account/wishlist/${slug}`, opts);
  const unwish = (c: Client, slug: string, opts = {}) => c.request('DELETE', `/api/v1/account/wishlist/${slug}`, opts);

  it('answers 401 signed out on GET, PUT and DELETE, never stored by a cache', async () => {
    const anon = h.client();
    for (const res of [await anon.get('/api/v1/account/wishlist'), await wish(anon, blue), await unwish(anon, blue)]) {
      expect(res.statusCode).toBe(401);
      expect(errorOf(res).code).toBe('UNAUTHORIZED');
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('keeps a model with PUT, reads the wishlist with GET (the latest first, max 200) and removes it with DELETE, each never stored; PUT and DELETE again land in the same state', async () => {
    const { client } = await accountClient(h);
    const empty = await client.get('/api/v1/account/wishlist');
    expect(empty.statusCode).toBe(200);
    expect(empty.headers['cache-control']).toBe('no-store');
    expect(safeJson(empty)).toEqual({ items: [], max: 200 });

    const added = await wish(client, blue);
    expect(added.statusCode).toBe(200);
    expect(added.headers['cache-control']).toBe('no-store');
    const blueItem = { state: 'SHOWN', slug: blue, name: 'MONOLITHE', variant: { label: 'Blue', swatch: '#1F3A93' }, type: 'RING', collection: null, imageUrl: null, discontinuedYear: null, reserved: false, addedAt: '2026-10-09T09:00:00.000Z' };
    expect(safeJson(added)).toEqual({ wished: true, item: blueItem, count: 1 });
    h.clock.advance(60_000);
    expect(safeJson(await wish(client, blue))).toEqual({ wished: true, item: blueItem, count: 1 });
    const soloAdded = safeJson(await wish(client, solo)) as any;
    expect(soloAdded.count).toBe(2);
    // A model hidden since: NOT_SHOWN, its name and variant only.
    await h.t.db.updateTable('models').set({ lookbook: 'HIDDEN' }).where('slug', '=', solo).execute();
    const listed = safeJson(await client.get('/api/v1/account/wishlist')) as any;
    expect(listed).toEqual({ items: [{ state: 'NOT_SHOWN', slug: solo, name: 'ORBITE', variant: null, addedAt: '2026-10-09T09:01:00.000Z' }, blueItem], max: 200 });
    await h.t.db.updateTable('models').set({ lookbook: 'PUBLIC' }).where('slug', '=', solo).execute();

    const removed = await unwish(client, blue);
    expect(removed.statusCode).toBe(200);
    expect(removed.headers['cache-control']).toBe('no-store');
    expect(safeJson(removed)).toEqual({ wished: false, count: 1 });
    expect(safeJson(await unwish(client, blue))).toEqual({ wished: false, count: 1 });
    // DELETE never says whether an address exists.
    for (const slug of ['no-such-model', hidden, 'x'.repeat(120), encodeURIComponent('../x')]) expect(safeJson(await unwish(client, slug))).toEqual({ wished: false, count: 1 });
    expect((safeJson(await client.get('/api/v1/account/wishlist')) as any).items.map((i: any) => i.slug)).toEqual([solo]);
  });

  it('answers 404 LOOKBOOK_NOT_FOUND for a model not in the collection, an unknown or malformed address, and 400 for an address of 129 characters or a body', async () => {
    const { client } = await accountClient(h);
    for (const slug of [hidden, 'no-such-model', 'Bad%20Slug', encodeURIComponent('../x'), 'x'.repeat(120)]) {
      const res = await wish(client, slug);
      expect(res.statusCode, slug).toBe(404);
      expect(errorOf(res)).toEqual({ code: 'LOOKBOOK_NOT_FOUND', message: 'This model is not in the ORBES collection.' });
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect((await wish(client, 'x'.repeat(129))).statusCode).toBe(400);
    expect((await unwish(client, 'x'.repeat(129))).statusCode).toBe(400);
    expect((await wish(client, blue, { body: { slug: blue } })).statusCode).toBe(400);
    expect(safeJson(await client.get('/api/v1/account/wishlist'))).toEqual({ items: [], max: 200 });
  });

  it('answers 409 WISHLIST_FULL at 200 open wishes, in the collector\'s words', async () => {
    const { client, email } = await accountClient(h);
    const id = (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email).executeTakeFirstOrThrow()).id;
    const filler = await Promise.all(Array.from({ length: 200 }, (_, i) => model({ name: `FILLER ${i}` })));
    await h.t.db.insertInto('account_wishes').values(filler.map((f, i) => ({ account_id: id, model_id: f.id, added_at: new Date(Date.parse('2026-10-01T00:00:00Z') + i * 1000) }))).execute();
    const res = await wish(client, blue);
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toEqual({ code: 'WISHLIST_FULL', message: 'Your wishlist holds up to 200 models. Remove one to add another.' });
    const listed = safeJson(await client.get('/api/v1/account/wishlist')) as any;
    expect(listed.items).toHaveLength(200);
    expect(listed.items[0].name).toBe('FILLER 199');
  });

  it('needs the CSRF token and the same origin on PUT and DELETE (403), nothing changed', async () => {
    const { client } = await accountClient(h);
    for (const send of [wish, unwish]) {
      const noToken = await send(client, blue, { noCsrf: true });
      expect(noToken.statusCode).toBe(403);
      expect(errorOf(noToken).code).toBe('CSRF_FAILED');
      const elsewhere = await send(client, blue, { origin: 'https://evil.example' });
      expect(elsewhere.statusCode).toBe(403);
      expect(errorOf(elsewhere).code).toBe('CSRF_FAILED');
    }
    expect(safeJson(await client.get('/api/v1/account/wishlist'))).toEqual({ items: [], max: 200 });
  });

  it('keeps each account\'s wishlist to itself, writes no audit entry, and names no staff or other account', async () => {
    const a = await accountClient(h);
    const b = await accountClient(h);
    await wish(a.client, blue);
    expect(safeJson(await b.client.get('/api/v1/account/wishlist'))).toEqual({ items: [], max: 200 });
    const res = await a.client.get('/api/v1/account/wishlist');
    expect(res.body).not.toMatch(/accountId|account_id|modelId|model_id|"id"|actor|audit|removedAt/);
    expect(await h.t.db.selectFrom('audit_logs').select('action').where('action', 'like', '%wish%').execute()).toEqual([]);
  });

  it('draws from the `api` rate group, as the account\'s other routes', async () => {
    const limited = await createHarness({ config: { rateLimits: { apiPerMinute: 3 } } });
    try {
      await limited.t.db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry' }).onConflict((oc) => oc.doNothing()).execute();
      const id = randomUUID();
      const slug = `wl-${id.slice(0, 8)}`;
      await limited.t.db.insertInto('models').values({ id, category_id: 1, name: 'RATED', type: 'RING', sku_prefix: `WL-${id.slice(0, 8)}`, slug, lookbook: 'PUBLIC', published_at: '2026-01-01T00:00:00Z' }).execute();
      const { client } = await accountClient(limited);
      const codes = [(await client.get('/api/v1/account/wishlist')).statusCode, (await wish(client, slug)).statusCode, (await unwish(client, slug)).statusCode];
      const over = await client.get('/api/v1/account/wishlist');
      expect([...codes, over.statusCode]).toEqual([200, 200, 200, 429]);
      expect(errorOf(over).code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });
});
