/**
 * WORN's routes (plan MACRO M2 §2.2 and §2.5, step M2.7; routes/ownership.ts, routes/public.ts, routes/club.ts;
 * services/worn.ts), through the application:
 *
 *  - the collector's: the piece's WORN (signed in, no-store, 404 for a piece never held), the sending (the session, the
 *    CSRF token and the same origin; the image itself as image/jpeg or image/webp, 1 MiB at most, any other type 415, a
 *    JSON body 415; the consent and Instagram in the query; 201 the piece's WORN), WITHDRAW (204, then 404), its own
 *    photograph (no-store, another account's 404); no other route of the file takes an image;
 *  - the public photograph: 404 before publishing, served once published (public, 5 minutes, its ETag the hash, 304 on
 *    revalidation), 404 after a withdrawal and after the piece passed on;
 *  - the sheets: a PUBLIC sheet's `worn` and its next pages (kept 5 minutes), the club's for a RESERVED sheet (an owner
 *    of its tier; 403 OWNERS_ONLY without a piece; never stored), the public's 404 for a RESERVED sheet.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES } from '../../src/server/media/image.js';
import { WORN_CONSENT_VERSION } from '../../src/server/services/worn.js';
import { GPS_SECRET, includesText, jpegPhoto, pngImage, SEGMENTS, withJpegSegments } from '../support/images.js';
import { createAccount, createModel, holdPieces } from '../support/live.js';
import { accountClient, adminClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

describe('WORN routes (plan MACRO M2 §2.2)', () => {
  let h: Harness;
  let operator: Client;
  let ring: { id: string; slug: string };
  let reserved: { id: string; slug: string };

  const phonePhoto = () => withJpegSegments(jpegPhoto(64, 48), [SEGMENTS.exifOriented(1)]);
  const upload = (c: Client, serial: string, bytes: Uint8Array, opts: { mime?: string; query?: string; noCsrf?: boolean; origin?: string | null } = {}) =>
    c.request('POST', `/api/v1/account/products/${serial}/worn${opts.query ?? `?consent=${WORN_CONSENT_VERSION}`}`, {
      body: Buffer.from(bytes),
      headers: { 'content-type': opts.mime ?? 'image/jpeg' },
      ...(opts.noCsrf ? { noCsrf: true } : {}),
      ...(opts.origin !== undefined ? { origin: opts.origin } : {}),
    });
  const accountIdOf = async (email: string) => (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email).executeTakeFirstOrThrow()).id;

  async function sheetModel(name: string, lookbook: 'PUBLIC' | 'RESERVED'): Promise<{ id: string; slug: string }> {
    const id = await createModel(h.ctx.db, name);
    const slug = `${name.toLowerCase()}-${id.slice(0, 8)}`;
    await h.ctx.db.updateTable('models').set({ slug, lookbook, published_at: new Date('2026-01-01T00:00:00Z') }).where('id', '=', id).execute();
    return { id, slug };
  }

  /** A signed-in collector (first name Owner, France) holding a new piece of `model`. */
  async function collector(model = ring.id) {
    const { client, email } = await accountClient(h);
    const id = await accountIdOf(email);
    const [pid] = await holdPieces(h.ctx.db, id, 1, model);
    const serial = (await h.ctx.db.selectFrom('products').select('product_id').where('id', '=', pid!).executeTakeFirstOrThrow()).product_id;
    return { client, email, id, productId: pid!, serial };
  }

  /** A photograph sent and published by the console. */
  async function published(c: Awaited<ReturnType<typeof collector>>) {
    const res = await upload(c.client, c.serial, phonePhoto());
    expect(res.statusCode, res.body).toBe(201);
    const id = (safeJson(res) as { photo: { id: string } }).photo.id;
    expect((await operator.post(`/api/admin/worn/${id}/publish`)).statusCode).toBe(204);
    return id;
  }

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-02T10:00:00.000Z');
    await h.t.db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry' }).onConflict((oc) => oc.doNothing()).execute();
    operator = await adminClient(h, 'OPERATOR');
    ring = await sheetModel('MONOLITHE', 'PUBLIC');
    reserved = await sheetModel('ZENITH', 'RESERVED');
  });
  afterAll(() => h?.close());

  it('reads the piece’s WORN signed in only, never stored; a piece never held is a 404', async () => {
    const c = await collector();
    const anon = await h.client().get(`/api/v1/account/products/${c.serial}/worn`);
    expect([anon.statusCode, errorOf(anon).code]).toEqual([401, 'UNAUTHORIZED']);
    const res = await c.client.get(`/api/v1/account/products/${c.serial}/worn`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(safeJson(res)).toEqual({ sheet: { slug: ring.slug }, photo: null, canSend: true, reason: null, credit: { firstName: 'Owner', country: 'France', instagram: null }, consentVersion: WORN_CONSENT_VERSION });
    const other = await collector();
    const theirs = await c.client.get(`/api/v1/account/products/${other.serial}/worn`);
    expect([theirs.statusCode, errorOf(theirs).code]).toEqual([404, 'PRODUCT_NOT_FOUND']);
  });

  it('sends the image itself with the CSRF token from the same origin; refuses other types, JSON and over 1 MiB', async () => {
    const c = await collector();
    expect(errorOf(await upload(c.client, c.serial, phonePhoto(), { noCsrf: true })).code).toBe('CSRF_FAILED');
    expect(errorOf(await upload(c.client, c.serial, phonePhoto(), { origin: 'https://evil.example' })).code).toBe('CSRF_FAILED');
    expect((await upload(h.client(), c.serial, phonePhoto())).statusCode).toBe(401);
    for (const [bytes, mime, expected] of [
      [pngImage(), 'image/png', [415, 'UNSUPPORTED_MEDIA_TYPE']],
      [pngImage(), 'image/jpeg', [400, 'IMAGE_INVALID']],
      [new TextEncoder().encode('{"image":"x"}'), 'application/json', [415, 'UNSUPPORTED_MEDIA_TYPE']],
    ] as const) {
      const res = await upload(c.client, c.serial, bytes, { mime });
      expect([res.statusCode, errorOf(res).code], mime).toEqual(expected);
    }
    const heavy = new Uint8Array(MAX_IMAGE_BYTES + 1);
    heavy.set(jpegPhoto());
    const big = await upload(c.client, c.serial, heavy);
    expect([big.statusCode, errorOf(big).code]).toEqual([413, 'PAYLOAD_TOO_LARGE']);
    const noConsent = await upload(c.client, c.serial, phonePhoto(), { query: '' });
    expect([noConsent.statusCode, errorOf(noConsent).code]).toEqual([422, 'WORN_CONSENT']);
    const bad = await upload(c.client, c.serial, phonePhoto(), { query: `?consent=${WORN_CONSENT_VERSION}&instagram=yes` });
    expect([bad.statusCode, errorOf(bad).code]).toEqual([400, 'VALIDATION_FAILED']);
    // No other route of the collector takes an image.
    const elsewhere = await c.client.request('POST', '/api/v1/ownership/transfers', { body: Buffer.from(phonePhoto()), headers: { 'content-type': 'image/jpeg' } });
    expect(elsewhere.statusCode).toBe(415);
    expect(await h.ctx.db.selectFrom('worn_photos').select('id').where('account_id', '=', c.id).execute()).toEqual([]);

    const res = await upload(c.client, c.serial, phonePhoto(), { query: `?instagram=0&consent=${WORN_CONSENT_VERSION}` });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const out = safeJson(res) as { photo: { id: string; status: string; url: string }; canSend: boolean; reason: string };
    expect(out).toMatchObject({ canSend: false, reason: 'LIVE', photo: { status: 'PENDING', url: `/api/v1/account/worn/${out.photo.id}/photo` } });
    const again = await upload(c.client, c.serial, phonePhoto());
    expect([again.statusCode, errorOf(again).code]).toEqual([409, 'WORN_ALREADY']);

    // Its own photograph: the stripped bytes, never stored; another account's: 404.
    const own = await c.client.get(out.photo.url);
    expect(own.statusCode).toBe(200);
    expect(own.headers['content-type']).toBe('image/jpeg');
    expect(own.headers['cache-control']).toBe('no-store');
    expect(includesText(new Uint8Array(own.rawPayload), GPS_SECRET)).toBe(false);
    const stranger = await collector();
    expect(errorOf(await stranger.client.get(out.photo.url)).code).toBe('WORN_NOT_FOUND');
    // In review: not public.
    const pub = await h.client().get(`/api/v1/worn/${out.photo.id}/photo`);
    expect([pub.statusCode, errorOf(pub).code]).toEqual([404, 'WORN_NOT_FOUND']);
    expect(pub.headers['cache-control']).toBe('no-store');

    // WITHDRAW: 204, then the same 404 as any unknown photograph; another account's too.
    expect(errorOf(await stranger.client.request('DELETE', `/api/v1/account/worn/${out.photo.id}`)).code).toBe('WORN_NOT_FOUND');
    expect((await c.client.request('DELETE', `/api/v1/account/worn/${out.photo.id}`, { noCsrf: true })).statusCode).toBe(403);
    expect((await c.client.request('DELETE', `/api/v1/account/worn/${out.photo.id}`)).statusCode).toBe(204);
    expect(errorOf(await c.client.request('DELETE', `/api/v1/account/worn/${out.photo.id}`)).code).toBe('WORN_NOT_FOUND');
    expect(errorOf(await c.client.get(out.photo.url)).code).toBe('WORN_NOT_FOUND');
    expect((safeJson(await c.client.get(`/api/v1/account/products/${c.serial}/worn`)) as { photo: unknown; canSend: boolean })).toMatchObject({ photo: null, canSend: true });
  });

  it('serves a published photograph to everyone for 5 minutes with its hash as ETag, and stops after a withdrawal or a transfer', async () => {
    const c = await collector();
    const id = await published(c);
    const row = await h.ctx.db.selectFrom('worn_photos').select(['photo', 'photo_sha256']).where('id', '=', id).executeTakeFirstOrThrow();
    const res = await h.client().get(`/api/v1/worn/${id}/photo`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.headers.etag).toBe(`"${row.photo_sha256}"`);
    expect(createHash('sha256').update(res.rawPayload).digest('hex')).toBe(row.photo_sha256);
    const again = await h.client().get(`/api/v1/worn/${id}/photo`, { headers: { 'if-none-match': `"${row.photo_sha256}"` } });
    expect(again.statusCode).toBe(304);
    expect(again.headers['cache-control']).toBe('public, max-age=300');
    const stale = await h.client().get(`/api/v1/worn/${id}/photo`, { headers: { 'if-none-match': '"0000"' } });
    expect(stale.statusCode).toBe(200);
    expect(stale.rawPayload.length).toBe(row.photo!.length);
    for (const bad of ['nope', '00000000-0000-4000-8000-000000000000']) expect(errorOf(await h.client().get(`/api/v1/worn/${bad}/photo`)).code).toBe('WORN_NOT_FOUND');
    // Withdrawn: gone at once (and from every cache within 5 minutes).
    expect((await c.client.request('DELETE', `/api/v1/account/worn/${id}`)).statusCode).toBe(204);
    expect((await h.client().get(`/api/v1/worn/${id}/photo`)).statusCode).toBe(404);
    expect((await h.client().get(`/api/v1/worn/${id}/photo`, { headers: { 'if-none-match': `"${row.photo_sha256}"` } })).statusCode).toBe(404);
    // Passed on: gone at once, before the job ends it.
    const d = await collector();
    const second = await published(d);
    expect((await h.client().get(`/api/v1/worn/${second}/photo`)).statusCode).toBe(200);
    const next = await createAccount(h.ctx.db);
    await h.ctx.db.updateTable('ownership').set({ ended_at: h.clock.now(), ended_reason: 'TRANSFERRED_OUT' }).where('product_id', '=', d.productId).where('ended_at', 'is', null).execute();
    await h.ctx.db.insertInto('ownership').values({ product_id: d.productId, account_id: next.id, acquired_via: 'TRANSFER', started_at: h.clock.now() }).execute();
    expect((await h.client().get(`/api/v1/worn/${second}/photo`)).statusCode).toBe(404);
    expect(await h.ctx.services.worn.endLeft(h.clock.now())).toBe(1);
  });

  it('carries a PUBLIC sheet’s WORN and its next pages for everyone, and a RESERVED sheet’s for its owners only', async () => {
    const before = safeJson(await h.client().get(`/api/v1/lookbook/${ring.slug}`)) as { worn: { photos: { id: string }[]; total: number } };
    const ids: string[] = [];
    for (let i = 0; i < 13; i++) {
      h.clock.advance(60_000);
      ids.push(await published(await collector()));
    }
    const sheet = await h.client().get(`/api/v1/lookbook/${ring.slug}`);
    const s = safeJson(sheet) as { worn: { photos: { id: string; url: string; credit: unknown }[]; total: number } };
    expect(s.worn.total).toBe(before.worn.total + 13);
    expect(s.worn.photos).toHaveLength(12);
    expect(s.worn.photos[0]).toEqual({ id: ids[12], url: `/api/v1/worn/${ids[12]}/photo`, width: 64, height: 48, credit: { firstName: 'Owner', country: 'France', instagram: null } });
    const page2 = await h.client().get(`/api/v1/lookbook/${ring.slug}/worn?page=2`);
    expect(page2.statusCode).toBe(200);
    expect(page2.headers['cache-control']).toBe('public, max-age=300');
    const p2 = safeJson(page2) as { photos: { id: string }[]; total: number; page: number; pageSize: number };
    expect(p2).toMatchObject({ total: s.worn.total, page: 2, pageSize: 12 });
    expect(p2.photos[0]!.id).toBe(ids[0]);
    expect((safeJson(await h.client().get(`/api/v1/lookbook/${ring.slug}/worn?page=x`)) as { page: number }).page).toBe(1);
    // A RESERVED sheet: the public's 404; an owner reaches it through the club, never stored.
    const owner = await collector(reserved.id);
    const rid = await published(owner);
    const pub = await h.client().get(`/api/v1/lookbook/${reserved.slug}/worn`);
    expect([pub.statusCode, errorOf(pub).code]).toEqual([404, 'LOOKBOOK_NOT_FOUND']);
    expect(pub.headers['cache-control']).toBe('no-store');
    const club = await owner.client.get(`/api/v1/club/lookbook/${reserved.slug}/worn`);
    expect(club.statusCode).toBe(200);
    expect(club.headers['cache-control']).toBe('no-store');
    expect((safeJson(club) as { photos: { id: string }[] }).photos.map((p) => p.id)).toEqual([rid]);
    expect(((safeJson(await owner.client.get(`/api/v1/club/lookbook/${reserved.slug}`)) as { worn: { total: number } }).worn.total)).toBe(1);
    // Its photograph itself is public once published, as a RESERVED model's are.
    expect((await h.client().get(`/api/v1/worn/${rid}/photo`)).statusCode).toBe(200);
    const { client: none } = await accountClient(h);
    const refused = await none.get(`/api/v1/club/lookbook/${reserved.slug}/worn`);
    expect([refused.statusCode, errorOf(refused).code]).toEqual([403, 'OWNERS_ONLY']);
    expect((await h.client().get(`/api/v1/club/lookbook/${reserved.slug}/worn`)).statusCode).toBe(401);
  });
});
