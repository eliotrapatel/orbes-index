/**
 * Photographs (F-04): a model's reference photograph (phase 1) and the
 * photograph of one piece (phase 2), uploaded by an OPERATOR as the image
 * itself (image/jpeg or image/webp, at most 1 MiB, on these routes only),
 * stripped of EXIF and XMP, stored once by SHA-256 (media_objects, 0012),
 * audited, and served publicly with an immutable cache by
 * GET /api/v1/media/:sha256. A verification shows them (`product.imageUrl`,
 * `product.photoUrl`) on the AUTHENTIC states only: never on UNKNOWN,
 * INVALID_SIGNATURE, SUSPICIOUS_ACTIVITY or REVOKED.
 */
import { createHash } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fromBase64Url, toBase64Url } from '../../src/core/bytes.js';
import { encodePayload, frameCodeData, signingMessage, unframeCodeData } from '../../src/core/payload.js';
import { MAX_IMAGE_BYTES } from '../../src/server/media/image.js';
import type { IssueResult } from '../../src/server/services/issuance.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import {
  chunk,
  GPS_SECRET,
  includesText,
  jpegPhoto,
  jpegPixels,
  SEGMENTS,
  SVG_IMAGE,
  pngImage,
  vp8l,
  vp8x,
  webp,
  webpChunks,
  withJpegSegments,
  XMP_SECRET,
} from '../support/images.js';
import { accountClient, adminClient, createHarness, errorOf, issue, safeJson, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

interface Outcome {
  state: string;
  product?: { productId: string; imageUrl?: string; photoUrl?: string };
  registration?: { token: string };
}

describe('photographs of models and pieces (F-04)', () => {
  let h: Harness;
  let operator: Client;
  let auditor: Client;
  let catalog: Catalog;
  let piece: IssueResult;

  const upload = (c: Client, url: string, bytes: Uint8Array, mime = 'image/jpeg', headers: Record<string, string> = {}) =>
    c.request('POST', url, { body: Buffer.from(bytes), headers: { 'content-type': mime, ...headers } });
  const modelImage = (id: string) => `/api/admin/models/${id}/image`;
  const piecePhoto = (pid: string) => `/api/admin/products/${pid}/photo`;
  const verify = async (code: string) => safeJson(await h.client().post('/api/v1/verify', { code })) as Outcome;
  const media = (url: string, headers: Record<string, string> = {}) => h.client().request('GET', url, { headers });
  const stored = (sha: string) => h.ctx.db.selectFrom('media_objects').selectAll().where('sha256', '=', sha).executeTakeFirst();
  const audits = (action: string) => h.ctx.db.selectFrom('audit_logs').selectAll().where('action', '=', action).orderBy('id').execute();

  beforeAll(async () => {
    h = await createHarness();
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    catalog = await seedCatalog(h.ctx);
    piece = await issue(h.ctx, catalog);
  });
  afterAll(() => h?.close());

  it('sets a model\'s reference photograph from a JPEG, stripped of its EXIF and XMP, and serves it with an immutable cache', async () => {
    const photo = jpegPhoto(64, 48);
    const tagged = withJpegSegments(photo, [SEGMENTS.exif(), SEGMENTS.xmp(), SEGMENTS.comment()]);
    expect(includesText(tagged, GPS_SECRET)).toBe(true);
    const res = await upload(operator, modelImage(catalog.modelId), tagged);
    expect(res.statusCode, res.body).toBe(200);
    const model = safeJson(res) as { id: string; imageUrl: string | null; products: number };
    expect(model).toMatchObject({ id: catalog.modelId, products: 1 });
    expect(model.imageUrl).toMatch(/^\/api\/v1\/media\/[0-9a-f]{64}$/);
    const sha = model.imageUrl!.split('/').pop()!;

    // Stored once, without the metadata, as the same picture, under the SHA-256 of what was kept.
    const row = (await stored(sha))!;
    expect(row).toMatchObject({ mime: 'image/jpeg', width: 64, height: 48 });
    expect(sha256(row.bytes)).toBe(sha);
    for (const s of [GPS_SECRET, XMP_SECRET]) expect(includesText(row.bytes, s), s).toBe(false);
    expect(Buffer.from(jpegPixels(row.bytes).data).equals(Buffer.from(jpegPixels(photo).data))).toBe(true);
    // The console user who uploaded it.
    const [entry] = await audits('model.image.set');
    expect(row.created_by).toBe(entry.actor_id);

    // Public: no session; cached for good, revalidated by its ETag; HEAD too.
    const got = await media(model.imageUrl!);
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('image/jpeg');
    expect(got.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(got.headers.etag).toBe(`"${sha}"`);
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(got.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(Buffer.from(got.rawPayload).equals(Buffer.from(row.bytes))).toBe(true);
    const again = await media(model.imageUrl!, { 'if-none-match': `"${sha}"` });
    expect(again.statusCode).toBe(304);
    expect(again.rawPayload.length).toBe(0);
    expect((await h.client().request('HEAD', model.imageUrl!)).statusCode).toBe(200);
    expect((await media(model.imageUrl!.toUpperCase().replace('/API/V1/MEDIA/', '/api/v1/media/'))).statusCode).toBe(200);

    // Audited with the image's facts and the pieces it reaches, never its bytes.
    expect(entry).toMatchObject({ actor_type: 'admin', target_type: 'model', target_id: catalog.modelId });
    expect(entry.details).toEqual({ sha256: sha, mime: 'image/jpeg', width: 64, height: 48, bytes: row.bytes.length, previous: null, issuedPieces: 1 });

    // GET /api/admin/models lists it.
    const list = safeJson(await auditor.get('/api/admin/models')) as { items: { id: string; imageUrl: string | null }[] };
    expect(list.items.find((m) => m.id === catalog.modelId)?.imageUrl).toBe(model.imageUrl);
  });

  it('refuses an SVG, a PNG, JSON and any other type: 415 for the type, 400 for bytes that are not what they claim', async () => {
    const url = modelImage(catalog.modelId);
    for (const [bytes, mime, expected] of [
      [SVG_IMAGE, 'image/svg+xml', [415, 'UNSUPPORTED_MEDIA_TYPE']],
      [pngImage(), 'image/png', [415, 'UNSUPPORTED_MEDIA_TYPE']],
      [SVG_IMAGE, 'image/jpeg', [400, 'IMAGE_INVALID']],
      [SVG_IMAGE, 'image/webp', [400, 'IMAGE_INVALID']],
      [pngImage(), 'image/jpeg', [400, 'IMAGE_INVALID']],
      [jpegPhoto(), 'image/webp', [400, 'IMAGE_INVALID']],
      [jpegPhoto(), 'application/octet-stream', [415, 'UNSUPPORTED_MEDIA_TYPE']],
      [new TextEncoder().encode('{"image":"x"}'), 'application/json', [415, 'UNSUPPORTED_MEDIA_TYPE']],
    ] as const) {
      const res = await upload(operator, url, bytes, mime);
      expect([res.statusCode, errorOf(res).code], `${mime}`).toEqual(expected);
    }
    expect(errorOf(await upload(operator, url, SVG_IMAGE, 'image/svg+xml')).message).toBe('Send the image itself, as image/jpeg or image/webp (at most 1 MB).');
    // No body at all.
    const empty = await operator.request('POST', url, {});
    expect([empty.statusCode, errorOf(empty).code]).toEqual([415, 'UNSUPPORTED_MEDIA_TYPE']);
    expect(await audits('model.image.set')).toHaveLength(1);
  });

  it('refuses an image over 1 MiB (413) and accepts one of exactly 1 MiB', async () => {
    const heavy = new Uint8Array(MAX_IMAGE_BYTES + 1);
    heavy.set(jpegPhoto());
    const res = await upload(operator, piecePhoto(piece.product.productId), heavy);
    expect([res.statusCode, errorOf(res).code]).toEqual([413, 'PAYLOAD_TOO_LARGE']);
    // The limit is the image routes' only: 17 KB of JSON elsewhere is still refused.
    const json = await operator.patch(`/api/admin/models/${catalog.modelId}`, { name: 'x'.repeat(17 * 1024) });
    expect([json.statusCode, errorOf(json).code]).toEqual([413, 'PAYLOAD_TOO_LARGE']);
    // …and no other route takes an image.
    const elsewhere = await upload(operator, `/api/admin/models/${catalog.modelId}`, jpegPhoto());
    expect(elsewhere.statusCode).toBe(404);
    const patchImage = await operator.request('PATCH', `/api/admin/models/${catalog.modelId}`, { body: Buffer.from(jpegPhoto()), headers: { 'content-type': 'image/jpeg' } });
    expect([patchImage.statusCode, errorOf(patchImage).code]).toEqual([415, 'UNSUPPORTED_MEDIA_TYPE']);
    // Exactly 1 MiB: a COM segment pads a real photograph to the limit (and goes with the metadata).
    const photo = jpegPhoto(40, 40);
    const comments: Uint8Array[] = [];
    for (let room = MAX_IMAGE_BYTES - photo.length; room > 0; ) {
      const n = Math.min(65533, room - 4);
      comments.push(padding(n));
      room -= n + 4;
    }
    const padded = withJpegSegments(photo, comments);
    expect(padded.length).toBe(MAX_IMAGE_BYTES);
    const ok = await upload(operator, piecePhoto(piece.product.productId), padded);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(sha256((await stored((safeJson(ok) as { photoUrl: string }).photoUrl.split('/').pop()!))!.bytes)).toBe(sha256(photo));
    expect((await operator.request('DELETE', piecePhoto(piece.product.productId))).statusCode).toBe(200);
  });

  it('refuses an animated WebP, and strips the EXIF and XMP chunks of a still one', async () => {
    const animated = webp([vp8x(0x02, 64, 64), chunk('ANIM', 'loop'), chunk('ANMF', 'frame'), chunk('ANMF', 'frame')]);
    const res = await upload(operator, piecePhoto(piece.product.productId), animated, 'image/webp');
    expect([res.statusCode, errorOf(res).code]).toEqual([400, 'IMAGE_ANIMATED']);
    const still = webp([vp8x(0x0c, 64, 64), vp8l(64, 64), chunk('EXIF', GPS_SECRET), chunk('XMP ', XMP_SECRET)]);
    const ok = await upload(operator, piecePhoto(piece.product.productId), still, 'image/webp');
    expect(ok.statusCode, ok.body).toBe(200);
    const url = (safeJson(ok) as { photoUrl: string }).photoUrl;
    const got = await media(url);
    expect(got.headers['content-type']).toBe('image/webp');
    expect(webpChunks(new Uint8Array(got.rawPayload))).toEqual(['VP8X', 'VP8L']);
    for (const s of [GPS_SECRET, XMP_SECRET]) expect(includesText(new Uint8Array(got.rawPayload), s), s).toBe(false);
    expect((await operator.request('DELETE', piecePhoto(piece.product.productId))).statusCode).toBe(200);
  });

  it('sets, replaces and removes the photograph of a piece; the product page shows both photographs', async () => {
    const pid = piece.product.productId;
    const first = jpegPhoto(30, 30);
    const res = await upload(operator, piecePhoto(pid.toLowerCase()), first);
    expect(res.statusCode, res.body).toBe(200);
    const body = safeJson(res) as { productId: string; photoUrl: string };
    expect(body).toEqual({ productId: pid, photoUrl: `/api/v1/media/${sha256(first)}` });
    const detail = safeJson(await auditor.get(`/api/admin/products/${pid}`)) as { product: { photoUrl: string | null; model: { imageUrl: string | null } } };
    expect(detail.product.photoUrl).toBe(body.photoUrl);
    expect(detail.product.model.imageUrl).toMatch(/^\/api\/v1\/media\/[0-9a-f]{64}$/);

    // The same photograph again changes nothing and writes nothing.
    const sets = (await audits('product.photo.set')).length;
    expect((await upload(operator, piecePhoto(pid), first)).statusCode).toBe(200);
    expect(await audits('product.photo.set')).toHaveLength(sets);

    // Replaced: audited with the one it replaced, which, used by nothing else, is no longer served.
    const second = jpegPhoto(31, 30);
    const replaced = safeJson(await upload(operator, piecePhoto(pid), second)) as { photoUrl: string };
    expect(replaced.photoUrl).toBe(`/api/v1/media/${sha256(second)}`);
    const last = (await audits('product.photo.set')).at(-1)!;
    expect(last).toMatchObject({ target_type: 'product', target_id: pid });
    expect(last.details).toMatchObject({ sha256: sha256(second), previous: sha256(first), width: 31, height: 30 });
    expect(await stored(sha256(first))).toBeUndefined();
    const gone = await media(body.photoUrl);
    expect([gone.statusCode, errorOf(gone).code]).toEqual([404, 'MEDIA_NOT_FOUND']);
    expect(gone.headers['cache-control']).toBe('no-store');

    // Removed: audited, no longer served; removing again changes nothing.
    const removed = await operator.request('DELETE', piecePhoto(pid));
    expect(removed.statusCode, removed.body).toBe(200);
    expect(safeJson(removed)).toEqual({ productId: pid, photoUrl: null });
    const [entry] = (await audits('product.photo.remove')).slice(-1);
    expect(entry.details).toEqual({ previous: sha256(second) });
    expect((await media(replaced.photoUrl)).statusCode).toBe(404);
    const removes = (await audits('product.photo.remove')).length;
    expect((await operator.request('DELETE', piecePhoto(pid))).statusCode).toBe(200);
    expect(await audits('product.photo.remove')).toHaveLength(removes);

    // An unknown piece or model: 404, after the image itself was checked.
    expect(errorOf(await upload(operator, piecePhoto('O26-J-99999'), first)).code).toBe('PRODUCT_NOT_FOUND');
    expect(errorOf(await upload(operator, modelImage('00000000-0000-4000-8000-000000000000'), first)).code).toBe('MODEL_NOT_FOUND');
    expect(errorOf(await operator.request('DELETE', modelImage('not-a-uuid'))).code).toBe('VALIDATION_FAILED');
  });

  it('stores the same photograph once, and keeps it while a model or a piece still uses it', async () => {
    const photo = jpegPhoto(20, 20);
    const sha = sha256(photo);
    const other = await issue(h.ctx, catalog);
    expect((await upload(operator, piecePhoto(other.product.productId), photo)).statusCode).toBe(200);
    expect((await upload(operator, piecePhoto(piece.product.productId), photo)).statusCode).toBe(200);
    expect((await h.ctx.db.selectFrom('media_objects').select('sha256').where('sha256', '=', sha).execute()).length).toBe(1);
    expect((await operator.request('DELETE', piecePhoto(other.product.productId))).statusCode).toBe(200);
    expect(await stored(sha)).toBeDefined();
    expect((await media(`/api/v1/media/${sha}`)).statusCode).toBe(200);
    expect((await operator.request('DELETE', piecePhoto(piece.product.productId))).statusCode).toBe(200);
    expect(await stored(sha)).toBeUndefined();
  });

  it('keeps an image that the removal of its last use deletes while an upload of the same bytes is storing it', async () => {
    // A model's photograph, about to lose its last use (removeModelImage) while the same bytes are uploaded for a piece.
    const photo = jpegPhoto(22, 22);
    const sha = sha256(photo);
    const own = await seedCatalog(h.ctx);
    const modelId = own.modelId;
    await h.ctx.services.media.setModelImage(modelId, { mime: 'image/jpeg', bytes: photo }, SYSTEM_ACTOR);
    const target = await issue(h.ctx, own);
    // The upload finds the row there (INSERT … ON CONFLICT DO NOTHING); right after, the removal commits: the model no
    // longer points to it and the row is deleted. Played inside the upload's transaction, which is where its effect
    // shows: the row is gone between the insert and the piece's pointer.
    const begin = h.ctx.db.transaction.bind(h.ctx.db);
    let removed = false;
    const removal = async (trx: typeof h.ctx.db) => {
      removed = true;
      await trx.updateTable('models').set({ image_sha256: null }).where('id', '=', modelId).execute();
      await trx.deleteFrom('media_objects').where('sha256', '=', sha).execute();
    };
    const afterExecute = <T extends object>(builder: T, then: () => Promise<void>): T =>
      new Proxy(builder, {
        get(b, prop) {
          const v = Reflect.get(b, prop, b) as unknown;
          if (typeof v !== 'function') return v;
          if (prop === 'execute') {
            return async (...args: unknown[]) => {
              const r = await (v as (...a: unknown[]) => Promise<unknown>).apply(b, args);
              await then();
              return r;
            };
          }
          return (...args: unknown[]) => {
            const r = (v as (...a: unknown[]) => unknown).apply(b, args);
            return r !== null && typeof r === 'object' ? afterExecute(r, then) : r;
          };
        },
      });
    const spy = vi.spyOn(h.ctx.db, 'transaction').mockImplementationOnce(() => {
      const builder = begin();
      return {
        execute: <R>(fn: (trx: typeof h.ctx.db) => Promise<R>) =>
          builder.execute((trx) =>
            fn(
              new Proxy(trx, {
                get(target, prop) {
                  const v = Reflect.get(target, prop, target) as unknown;
                  if (prop === 'insertInto') {
                    return (table: 'media_objects') => {
                      const b = target.insertInto(table);
                      return table === 'media_objects' && !removed ? afterExecute(b, () => removal(target)) : b;
                    };
                  }
                  return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
                },
              }),
            ),
          ),
      } as unknown as ReturnType<typeof begin>;
    });
    try {
      const r = await h.ctx.services.media.setProductPhoto(target.product.productId, { mime: 'image/jpeg', bytes: photo }, SYSTEM_ACTOR);
      expect(r.photoUrl).toBe(`/api/v1/media/${sha}`);
    } finally {
      spy.mockRestore();
    }
    expect(removed).toBe(true);
    // Stored again by the upload: the piece points to it, and it is served.
    expect(await stored(sha)).toBeDefined();
    expect((await h.ctx.db.selectFrom('products').select('photo_sha256').where('product_id', '=', target.product.productId).executeTakeFirstOrThrow()).photo_sha256).toBe(sha);
    expect((await media(`/api/v1/media/${sha}`)).statusCode).toBe(200);
  });

  it('removes a model\'s reference photograph (audited model.image.remove)', async () => {
    const before = (safeJson(await auditor.get('/api/admin/models')) as { items: { id: string; imageUrl: string | null }[] }).items.find((m) => m.id === catalog.modelId)!;
    expect(before.imageUrl).not.toBeNull();
    const res = await operator.request('DELETE', modelImage(catalog.modelId));
    expect(res.statusCode, res.body).toBe(200);
    expect(safeJson(res)).toMatchObject({ id: catalog.modelId, imageUrl: null });
    const [entry] = await audits('model.image.remove');
    expect(entry.details).toEqual({ previous: before.imageUrl!.split('/').pop(), issuedPieces: 2 });
    expect((await media(before.imageUrl!)).statusCode).toBe(404);
    // Nothing to remove: nothing written.
    expect((await operator.request('DELETE', modelImage(catalog.modelId))).statusCode).toBe(200);
    expect(await audits('model.image.remove')).toHaveLength(1);
  });

  it('needs the CSRF token, an OPERATOR, and a session: checked before the body is read', async () => {
    const url = modelImage(catalog.modelId);
    const noCsrf = await operator.request('POST', url, { body: Buffer.from(jpegPhoto()), headers: { 'content-type': 'image/jpeg' }, noCsrf: true });
    expect([noCsrf.statusCode, errorOf(noCsrf).code]).toEqual([403, 'CSRF_FAILED']);
    const crossSite = await operator.request('POST', url, { body: Buffer.from(jpegPhoto()), headers: { 'content-type': 'image/jpeg' }, origin: 'https://evil.example' });
    expect([crossSite.statusCode, errorOf(crossSite).code]).toEqual([403, 'CSRF_FAILED']);
    const audit = await upload(auditor, url, jpegPhoto());
    expect([audit.statusCode, errorOf(audit).code]).toEqual([403, 'FORBIDDEN']);
    // Refused before the 1 MiB body is even parsed.
    const anon = await upload(h.client(), url, new Uint8Array(MAX_IMAGE_BYTES + 10));
    expect(anon.statusCode).toBe(401);
  });

  it('answers 400 for a malformed hash and 404 for an unknown one', async () => {
    expect(errorOf(await media('/api/v1/media/not-a-hash')).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await media(`/api/v1/media/${'ab'.repeat(32)}`)).code).toBe('MEDIA_NOT_FOUND');
    // A revalidation of an unknown image is not a 304.
    expect((await media(`/api/v1/media/${'ab'.repeat(32)}`, { 'if-none-match': `"${'ab'.repeat(32)}"` })).statusCode).toBe(404);
  });

  describe('on the result of a verification', () => {
    let modelUrl: string;
    let photoUrl: string;
    let lost: IssueResult;
    let revoked: IssueResult;
    let sold: IssueResult;

    beforeAll(async () => {
      modelUrl = (safeJson(await upload(operator, modelImage(catalog.modelId), jpegPhoto(50, 40))) as { imageUrl: string }).imageUrl;
      photoUrl = (safeJson(await upload(operator, piecePhoto(piece.product.productId), jpegPhoto(41, 40))) as { photoUrl: string }).photoUrl;
      lost = await issue(h.ctx, catalog);
      revoked = await issue(h.ctx, catalog);
      sold = await issue(h.ctx, catalog);
      for (const p of [lost, revoked, sold]) await h.ctx.services.media.setProductPhoto(p.product.productId, { mime: 'image/jpeg', bytes: jpegPhoto(42, 40) }, SYSTEM_ACTOR);
      await h.ctx.services.warranty.activate(lost.product.productId, { purchaseDate: '2026-09-01' }, SYSTEM_ACTOR);
      await h.ctx.services.lifecycle.transition(lost.product.productId, 'LOST', { reason: 'test' }, SYSTEM_ACTOR);
      await h.ctx.services.lifecycle.transition(revoked.product.productId, 'REVOKED', { reason: 'test' }, SYSTEM_ACTOR);
      await h.ctx.services.warranty.activate(sold.product.productId, { purchaseDate: '2026-09-01' }, SYSTEM_ACTOR);
    });

    it('AUTHENTIC states: the model\'s reference photograph and the piece\'s own, as URLs of this origin', async () => {
      const out = await verify(piece.code.data);
      expect(out.state).toBe('AUTHENTIC');
      expect(out.product).toMatchObject({ productId: piece.product.productId, imageUrl: modelUrl, photoUrl });
      const first = await verify(sold.code.data);
      expect(first.state).toBe('AUTHENTIC_FIRST_REGISTRATION');
      expect(first.product?.imageUrl).toBe(modelUrl);
      expect(first.product?.photoUrl).toMatch(/^\/api\/v1\/media\/[0-9a-f]{64}$/);
      // Each URL serves the image.
      for (const url of [modelUrl, photoUrl, first.product!.photoUrl!]) expect((await media(url)).statusCode, url).toBe(200);
      // A piece without a photograph of its own shows the model's only.
      const plain = await issue(h.ctx, catalog);
      const p = (await verify(plain.code.data)).product!;
      expect(p.imageUrl).toBe(modelUrl);
      expect(p).not.toHaveProperty('photoUrl');
    });

    it('the owner\'s product list carries them too', async () => {
      const { client } = await accountClient(h);
      const scan = (safeJson(await client.post('/api/v1/verify', { code: sold.code.data })) as Outcome).registration!;
      expect((await client.post('/api/v1/ownership/register', { registrationToken: scan.token })).statusCode).toBe(201);
      const list = safeJson(await client.get('/api/v1/account/products')) as { products: { productId: string; imageUrl: string | null; photoUrl: string | null }[] };
      expect(list.products).toEqual([expect.objectContaining({ productId: sold.product.productId, imageUrl: modelUrl, photoUrl: expect.stringMatching(/^\/api\/v1\/media\//) })]);
    });

    it('never on UNKNOWN, INVALID_SIGNATURE, SUSPICIOUS_ACTIVITY or REVOKED', async () => {
      const urls = (r: LightMyRequestResponse) => [...r.body.matchAll(/\/api\/v1\/media\/[0-9a-f]{64}/g)].map((m) => m[0]);
      // INVALID_SIGNATURE: the code of a piece with both photographs, one signature bit flipped.
      const { payloadBytes, signature } = unframeCodeData(fromBase64Url(piece.code.data));
      signature[0] ^= 1;
      const forged = await h.client().post('/api/v1/verify', { code: toBase64Url(frameCodeData(payloadBytes, signature)) });
      expect((safeJson(forged) as Outcome).state).toBe('INVALID_SIGNATURE');
      expect(urls(forged)).toEqual([]);
      expect(safeJson(forged)).not.toHaveProperty('product');
      // UNKNOWN: a validly signed identity that was never registered.
      const signer = await h.ctx.keys.activeSigner();
      const payload = encodePayload({ codeVersion: 1, genomeVersion: 1, keyId: signer.keyId, identity: { year: 2026, categoryIndex: 1, serial: 77_777 }, issue: 1, issuedDay: 900, nonce: new Uint8Array(4) });
      const unknown = await h.client().post('/api/v1/verify', { code: toBase64Url(frameCodeData(payload, await signer.sign(signingMessage(payload)))) });
      expect((safeJson(unknown) as Outcome).state).toBe('UNKNOWN');
      expect(urls(unknown)).toEqual([]);
      // A piece declared lost, and a revoked one, both with photographs.
      for (const [p, state] of [[lost, 'SUSPICIOUS_ACTIVITY'], [revoked, 'REVOKED']] as const) {
        const r = await h.client().post('/api/v1/verify', { code: p.code.data });
        expect((safeJson(r) as Outcome).state).toBe(state);
        expect(urls(r), state).toEqual([]);
        expect(safeJson(r), state).not.toHaveProperty('product');
      }
    });
  });
});

/** A COM segment of `n` payload bytes (comments are dropped with the metadata). */
function padding(n: number): Uint8Array {
  const out = new Uint8Array(n + 4);
  out.set([0xff, 0xfe, ((n + 2) >> 8) & 0xff, (n + 2) & 0xff]);
  out.fill(0x20, 4);
  return out;
}
