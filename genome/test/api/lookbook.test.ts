/**
 * The lookbook of the models (P-R02): a model's place in it (HIDDEN, PUBLIC,
 * RESERVED), the address of its sheet, its story and its specifications,
 * edited with PATCH /api/admin/models/:id (OPERATOR) and audited
 * `model.update` (the story as its length and hash); its gallery (POST,
 * DELETE, PATCH /api/admin/models/:id/gallery: the image itself through
 * MediaService, at most 8, in an order, with alternative texts); the public
 * lists and sheets (GET /api/v1/lookbook, /:slug: PUBLIC only, cached 5
 * minutes, the same for everyone); the club (GET /api/v1/club/lookbook,
 * /:slug: the RESERVED models, for an account that holds a piece now, never
 * stored; its routes GET, its mutations POST only); the photographs' own rate
 * budget; and `product.lookbook` on an AUTHENTIC result of a PUBLIC model.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MEDIA_RATE_FACTOR } from '../../src/server/http/rate-limit.js';
import type { IssueResult } from '../../src/server/services/issuance.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { readDoc } from '../docs/lexicon.js';
import { jpegPhoto, SVG_IMAGE } from '../support/images.js';
import { createAccount, createCollection, createLiveRelease, holdPieces, liveFixtureOn, type LiveFixture } from '../support/live.js';
import { accountClient, adminClient, createHarness, errorOf, issue, safeJson, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

interface GalleryImage {
  sha256: string;
  url: string;
  alt: string | null;
  position: number;
}

interface ModelJson {
  id: string;
  name: string;
  lookbook: 'HIDDEN' | 'PUBLIC' | 'RESERVED';
  slug: string | null;
  story: string | null;
  specs: string | null;
  publishedAt: string | null;
  imageUrl: string | null;
  gallery: GalleryImage[];
}

interface Card {
  slug: string;
  name: string;
  type: string;
  category: { code: string; name: string };
  collection: string | null;
  imageUrl: string | null;
  /** NOCTURNE N1: its own dot and its group's dots. */
  variant: unknown;
  variants: unknown[];
}

interface Sheet {
  slug: string;
  lookbook: 'PUBLIC' | 'RESERVED';
  name: string;
  type: string;
  category: { code: string; name: string };
  collection: string | null;
  coverUrl: string | null;
  gallery: { url: string; alt: string | null }[];
  story: string | null;
  specs: { label: string; value: string }[];
  care: string | null;
  discontinuedYear: number | null;
  /** NOCTURNE N1: its own dot and its group's dots. */
  variant: unknown;
  variants: unknown[];
  /** NOCTURNE N3: its sizes, from the SKUs of the model and its variants. */
  sizes: string[];
  /** Plan NEXT-NINE, CO-01: THE RELEASES OF THIS MODEL. */
  releases: unknown[];
  /** Plan NEXT-NINE, BP-34: PAIRS WELL WITH. */
  pairs: unknown[];
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('the lookbook of the models (P-R02)', () => {
  let h: Harness;
  let operator: Client;
  let auditor: Client;
  let catalog: Catalog;
  let piece: IssueResult;

  const model = (id: string) => `/api/admin/models/${id}`;
  const gallery = (id: string) => `/api/admin/models/${id}/gallery`;
  const patch = (id: string, body: unknown, c: Client = operator) => c.patch(model(id), body);
  const read = async (id: string) => safeJson(await auditor.get(model(id))) as ModelJson;
  const upload = (c: Client, url: string, bytes: Uint8Array, mime = 'image/jpeg') => c.request('POST', url, { body: Buffer.from(bytes), headers: { 'content-type': mime } });
  const audits = (action: string) => h.ctx.db.selectFrom('audit_logs').selectAll().where('action', '=', action).orderBy('id').execute();
  const publicList = async () => (safeJson(await h.client().get('/api/v1/lookbook')) as { models: Card[] }).models;
  const stored = (sha: string) => h.ctx.db.selectFrom('media_objects').select('sha256').where('sha256', '=', sha).executeTakeFirst();

  /** Another model of the catalogue, in its own collection (or none). */
  async function otherModel(name: string, collection: string | null): Promise<string> {
    const col = collection ? (await h.ctx.db.insertInto('collections').values({ name: collection }).returning('id').executeTakeFirstOrThrow()).id : null;
    const created = safeJson(
      await operator.post('/api/admin/models', { categoryCode: 'J', name, type: 'PENDANT', skuPrefix: `LB-${name.slice(0, 6)}`, sizeType: 'ONE_SIZE', ...(col ? { collectionId: col } : {}) }),
    ) as { id: string };
    return created.id;
  }

  /** A piece registered to the customer behind `c`, through a scan and its registration token. */
  async function ownedPiece(c: Client): Promise<IssueResult> {
    const p = await issue(h.ctx, catalog);
    await h.ctx.services.warranty.activate(p.product.productId, { retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    const scan = safeJson(await c.post('/api/v1/verify', { code: p.code.data })) as { registration: { token: string } };
    expect((await c.post('/api/v1/ownership/register', { registrationToken: scan.registration.token })).statusCode).toBe(201);
    return p;
  }

  beforeAll(async () => {
    h = await createHarness();
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    catalog = await seedCatalog(h.ctx);
    piece = await issue(h.ctx, catalog);
  });
  afterAll(() => h?.close());

  it('keeps every model HIDDEN without an address until the console shows it: nothing public, no lookbook on its results', async () => {
    const m = await read(catalog.modelId);
    expect(m).toMatchObject({ lookbook: 'HIDDEN', slug: null, story: null, specs: null, publishedAt: null, gallery: [] });
    // The list and the one model answer alike; the one model read alone adds its pairs (plan NEXT-NINE, BP-34: none here).
    const listed = (safeJson(await auditor.get('/api/admin/models')) as { items: ModelJson[] }).items.find((x) => x.id === catalog.modelId);
    const { pairs, pairsFallback, ...alone } = m as ModelJson & { pairs: unknown; pairsFallback: unknown };
    expect(listed).toEqual(alone);
    expect([pairs, pairsFallback]).toEqual([[], []]);
    expect(await publicList()).toEqual([]);
    const verified = safeJson(await h.client().post('/api/v1/verify', { code: piece.code.data })) as { state: string; product?: Record<string, unknown> };
    expect(verified.state).toMatch(/^AUTHENTIC/);
    expect(verified.product).not.toHaveProperty('lookbook');
    expect(errorOf(await auditor.get(model('00000000-0000-4000-8000-000000000000'))).code).toBe('MODEL_NOT_FOUND');
    expect(errorOf(await auditor.get(model('nope'))).code).toBe('VALIDATION_FAILED');
  });

  it('PATCH: the address is checked and lower-cased, a model shown needs one, and its story and specifications are held to their form', async () => {
    const refused = async (body: unknown, code = 'VALIDATION_FAILED') => {
      const res = await patch(catalog.modelId, body);
      expect([res.statusCode, errorOf(res).code], JSON.stringify(body).slice(0, 60)).toEqual([code === 'VALIDATION_FAILED' ? 400 : 409, code]);
      return errorOf(res).message;
    };
    for (const slug of ['mono lithe', 'mono--lithe', '-mono', 'é-mono', 'a'.repeat(81)]) await refused({ slug });
    expect(await refused({ lookbook: 'PUBLIC' })).toBe('A model shown in the lookbook needs the address of its sheet (slug).');
    await refused({ lookbook: 'SHOWN' });
    expect(await refused({ specs: 'Metal 925 silver' })).toMatch(/^Specifications, line 1: write it as Label: value/);
    expect(await refused({ specs: 'Metal: silver\nSize 52: yes' })).toMatch(/^Specifications, line 2: a label has no figure/);
    expect(await refused({ specs: 'Metal:' })).toMatch(/line 1/);
    await refused({ story: 'x'.repeat(4001) });
    await refused({ story: 'A\u0007bell' });
    await refused({ specs: 'x'.repeat(1001) });

    const res = await patch(catalog.modelId, {
      slug: '  Monolithe-Ring ',
      story: '  The first ring of ORBES.  \r\n\r\n\r\n\r\nCast in Paris.\nPolished by hand.  ',
      specs: 'Metal :  925 sterling silver \n\n Weight: 12 g\r\nSizes: 48 to 60',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(safeJson(res)).toMatchObject({
      lookbook: 'HIDDEN',
      slug: 'monolithe-ring',
      story: 'The first ring of ORBES.\n\nCast in Paris.\nPolished by hand.',
      specs: 'Metal: 925 sterling silver\nWeight: 12 g\nSizes: 48 to 60',
      publishedAt: null,
    });
    // Hidden, an address may still change or go.
    expect((await patch(catalog.modelId, { slug: 'monolithe' })).statusCode).toBe(200);
    expect((await read(catalog.modelId)).slug).toBe('monolithe');
    expect((await patch(catalog.modelId, { slug: 'monolithe-ring' })).statusCode).toBe(200);
    // An AUDITOR reads, never writes; the CSRF token is required.
    expect(errorOf(await patch(catalog.modelId, { slug: 'x' }, auditor)).code).toBe('FORBIDDEN');
    expect((await operator.patch(model(catalog.modelId), { slug: 'x' }, { noCsrf: true })).statusCode).toBe(403);
  });

  it('publishes a model: publishedAt is set once, the story audited as its length and hash, and the address fixed from then on', async () => {
    const before = await read(catalog.modelId);
    const res = await patch(catalog.modelId, { lookbook: 'PUBLIC' });
    expect(res.statusCode, res.body).toBe(200);
    const published = safeJson(res) as ModelJson;
    expect(published.lookbook).toBe('PUBLIC');
    expect(published.publishedAt).toBe(new Date(h.clock.now()).toISOString());

    // The address never changes once published (409), even hidden again; it cannot be cleared either.
    for (const slug of ['monolithe-ii', null, '']) {
      const r = await patch(catalog.modelId, { slug });
      expect([r.statusCode, errorOf(r).code], String(slug)).toEqual([409, 'SLUG_LOCKED']);
    }
    expect((await patch(catalog.modelId, { lookbook: 'HIDDEN' })).statusCode).toBe(200);
    expect(errorOf(await patch(catalog.modelId, { slug: 'monolithe-ii' })).code).toBe('SLUG_LOCKED');
    // The same address again changes nothing.
    expect((await patch(catalog.modelId, { slug: 'monolithe-ring' })).statusCode).toBe(200);
    h.clock.advance(60_000);
    expect((await patch(catalog.modelId, { lookbook: 'PUBLIC' })).statusCode).toBe(200);
    expect((await read(catalog.modelId)).publishedAt).toBe(published.publishedAt);

    // Another model may not take its address.
    const other = await otherModel('ECLIPSE', 'NOCTURNE');
    const taken = await patch(other, { slug: 'Monolithe-Ring' });
    expect([taken.statusCode, errorOf(taken)]).toEqual([409, { code: 'SLUG_TAKEN', message: 'Another model already has this address in the lookbook (slug).' }]);

    const rows = (await audits('model.update')).filter((r) => r.target_id === catalog.modelId);
    const story = before.story!;
    const fingerprint = { length: story.length, sha256: createHash('sha256').update(story, 'utf8').digest('hex') };
    const withStory = rows.find((r) => JSON.stringify(r.details).includes('"story"'))!;
    expect(withStory.details).toMatchObject({ before: { story: null }, after: { story: fingerprint } });
    // Never the words of the story in the permanent log.
    for (const r of rows) expect(JSON.stringify(r.details)).not.toContain('Cast in Paris');
    const publication = rows.find((r) => JSON.stringify(r.details).includes('publishedAt'))!;
    expect(publication.details).toEqual({ before: { lookbook: 'HIDDEN', publishedAt: null }, after: { lookbook: 'PUBLIC', publishedAt: published.publishedAt }, issuedPieces: 1 });
    expect(rows.filter((r) => JSON.stringify(r.details).includes('publishedAt'))).toHaveLength(1);
  });

  it('the gallery: photographs through MediaService, at most 8, the cover apart, in an order, with alternative texts; a removal moves the next ones up', async () => {
    const photos = Array.from({ length: 9 }, (_, i) => jpegPhoto(40 + i, 30));
    // The cover: the reference photograph (F-04).
    const cover = jpegPhoto(64, 48);
    expect((await upload(operator, `${model(catalog.modelId)}/image`, cover)).statusCode).toBe(200);
    const coverRefused = await upload(operator, gallery(catalog.modelId), cover);
    expect([coverRefused.statusCode, errorOf(coverRefused).code]).toEqual([409, 'IMAGE_IS_COVER']);

    for (const p of photos.slice(0, 8)) {
      const res = await upload(operator, gallery(catalog.modelId), p);
      expect(res.statusCode, res.body).toBe(200);
    }
    let m = await read(catalog.modelId);
    expect(m.gallery.map((g) => [g.position, g.sha256])).toEqual(photos.slice(0, 8).map((p, i) => [i + 1, sha256(p)]));
    expect(m.gallery.every((g) => g.url === `/api/v1/media/${g.sha256}` && g.alt === null)).toBe(true);
    // The same photograph again writes nothing; a ninth is refused.
    expect((await upload(operator, gallery(catalog.modelId), photos[0]!)).statusCode).toBe(200);
    const full = await upload(operator, gallery(catalog.modelId), photos[8]!);
    expect([full.statusCode, errorOf(full).code]).toEqual([409, 'GALLERY_FULL']);
    expect(await stored(sha256(photos[8]!))).toBeUndefined();
    // The image itself, as for the reference photograph: anything else is refused.
    expect((await upload(operator, gallery(catalog.modelId), SVG_IMAGE, 'image/svg+xml')).statusCode).toBe(415);
    expect((await operator.post(gallery(catalog.modelId), { sha256: sha256(photos[0]!) })).statusCode).toBe(415);
    expect(errorOf(await upload(auditor, gallery(catalog.modelId), photos[8]!)).code).toBe('FORBIDDEN');
    expect(errorOf(await upload(operator, gallery('00000000-0000-4000-8000-000000000000'), photos[8]!)).code).toBe('MODEL_NOT_FOUND');
    expect((await audits('model.gallery.add')).map((r) => (r.details as { position: number }).position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    // The order and the alternative texts: every photograph once, in the new order.
    const order = [...m.gallery].reverse().map((g, i) => ({ sha256: g.sha256, alt: i === 0 ? 'The ring on its side, the stone up' : '' }));
    const arranged = await operator.patch(gallery(catalog.modelId), { images: order });
    expect(arranged.statusCode, arranged.body).toBe(200);
    m = safeJson(arranged) as ModelJson;
    expect(m.gallery.map((g) => g.sha256)).toEqual(order.map((o) => o.sha256));
    expect(m.gallery[0]).toMatchObject({ position: 1, alt: 'The ring on its side, the stone up' });
    // Unchanged, nothing is written (an alternative text left out is kept); a list that no longer matches the gallery is refused.
    expect((await operator.patch(gallery(catalog.modelId), { images: order })).statusCode).toBe(200);
    const kept = safeJson(await operator.patch(gallery(catalog.modelId), { images: order.map((o) => ({ sha256: o.sha256 })) })) as ModelJson;
    expect(kept.gallery[0]).toMatchObject({ position: 1, alt: 'The ring on its side, the stone up' });
    expect(await audits('model.gallery.update')).toHaveLength(1);
    for (const images of [order.slice(1), [...order.slice(0, 7), { sha256: sha256(photos[8]!) }], [order[0], ...order.slice(0, 7)]]) {
      const res = await operator.patch(gallery(catalog.modelId), { images });
      expect([res.statusCode, errorOf(res).code]).toEqual([409, 'GALLERY_CHANGED']);
    }
    for (const body of [{ images: order.map((o) => ({ ...o, alt: 'two\nlines' })) }, { images: [{ sha256: 'nope' }] }, { images: order, extra: 1 }, {}]) {
      expect(errorOf(await operator.patch(gallery(catalog.modelId), body)).code, JSON.stringify(body).slice(0, 40)).toBe('VALIDATION_FAILED');
    }

    // Removed: the next ones move up, positions stay 1…n; the image, used nowhere else, is deleted.
    const gone = m.gallery[1]!;
    const removed = await operator.request('DELETE', `${gallery(catalog.modelId)}/${gone.sha256.toUpperCase()}`);
    expect(removed.statusCode, removed.body).toBe(200);
    m = safeJson(removed) as ModelJson;
    expect(m.gallery.map((g) => g.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(m.gallery.map((g) => g.sha256)).not.toContain(gone.sha256);
    expect(await stored(gone.sha256)).toBeUndefined();
    expect((await h.client().get(gone.url)).statusCode).toBe(404);
    expect(errorOf(await operator.request('DELETE', `${gallery(catalog.modelId)}/${gone.sha256}`)).code).toBe('GALLERY_IMAGE_NOT_FOUND');
    expect(errorOf(await operator.request('DELETE', `${gallery(catalog.modelId)}/nope`)).code).toBe('VALIDATION_FAILED');
    expect((await audits('model.gallery.remove')).map((r) => r.details)).toEqual([{ sha256: gone.sha256, position: 2 }]);

    // A photograph a gallery uses is kept when the reference photograph it was is replaced.
    const shared = m.gallery[0]!;
    const asCover = Uint8Array.from(photos.find((p) => sha256(p) === shared.sha256)!);
    expect((await upload(operator, `${model(catalog.modelId)}/image`, asCover)).statusCode).toBe(200);
    expect((await upload(operator, `${model(catalog.modelId)}/image`, cover)).statusCode).toBe(200);
    expect(await stored(shared.sha256)).toBeDefined();
  });

  it('GET /api/v1/lookbook and /:slug: the PUBLIC models by collection, without their stories, the same for everyone, cached 5 minutes', async () => {
    const eclipse = (await h.ctx.db.selectFrom('models').select('id').where('name', '=', 'ECLIPSE').executeTakeFirstOrThrow()).id;
    expect((await patch(eclipse, { slug: 'eclipse', lookbook: 'PUBLIC' })).statusCode).toBe(200);
    const solo = await otherModel('AURORE', null);
    expect((await patch(solo, { slug: 'aurore', lookbook: 'PUBLIC' })).statusCode).toBe(200);
    const reserved = await otherModel('ZENITH', 'NOCTURNE II');
    expect((await patch(reserved, { slug: 'zenith', lookbook: 'RESERVED', story: 'For the owners.' })).statusCode).toBe(200);

    const res = await h.client().get('/api/v1/lookbook');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.headers['set-cookie']).toBeUndefined();
    const { models } = safeJson(res) as { models: Card[] };
    // By collection, a model without one last; RESERVED and HIDDEN models are not listed.
    expect(models.map((c) => [c.collection, c.slug])).toEqual([
      ['NOCTURNE', 'eclipse'],
      [expect.stringMatching(/^ORBIT-/), 'monolithe-ring'],
      [null, 'aurore'],
    ]);
    // NOCTURNE N1: its own dot and its group's dots (none for a model alone).
    // NOCTURNE N3: when it was last published (NOW leads with the newest) and its sizes from its SKUs.
    for (const c of models) expect(Object.keys(c).sort()).toEqual(['category', 'collection', 'imageUrl', 'name', 'publishedAt', 'sizes', 'slug', 'type', 'variant', 'variants']);
    for (const c of models) expect([c.variant, c.variants]).toEqual([null, []]);
    const mono = models.find((c) => c.slug === 'monolithe-ring')!;
    expect(mono).toMatchObject({ name: 'MONOLITHE', type: 'RING', category: { code: 'J', name: 'Jewelry' } });
    expect(mono.imageUrl).toBe((await read(catalog.modelId)).imageUrl);
    expect(models.find((c) => c.slug === 'eclipse')!.imageUrl).toBeNull();
    // Signed in, the same answer: nothing depends on the session.
    const { client } = await accountClient(h);
    expect(safeJson(await client.get('/api/v1/lookbook'))).toEqual({ models });

    const sheet = await h.client().get('/api/v1/lookbook/MONOLITHE-RING');
    expect(sheet.statusCode, sheet.body).toBe(200);
    expect(sheet.headers['cache-control']).toBe('public, max-age=300');
    const m = await read(catalog.modelId);
    expect(safeJson(sheet)).toEqual({
      slug: 'monolithe-ring',
      lookbook: 'PUBLIC',
      name: 'MONOLITHE',
      type: 'RING',
      category: { code: 'J', name: 'Jewelry' },
      collection: mono.collection,
      coverUrl: m.imageUrl,
      gallery: m.gallery.map((g) => ({ url: g.url, alt: g.alt })),
      story: 'The first ring of ORBES.\n\nCast in Paris.\nPolished by hand.',
      specs: [
        { label: 'Metal', value: '925 sterling silver' },
        { label: 'Weight', value: '12 g' },
        { label: 'Sizes', value: '48 to 60' },
      ],
      care: 'Polish with a soft dry cloth.',
      discontinuedYear: null,
      variant: null,
      variants: [],
      // NOCTURNE N3 (addition 8): its sizes from its SKUs; its piece issued in one size names none.
      sizes: [],
      // Plan NEXT-NINE, CO-01: never released, no past release.
      releases: [],
      // Plan NEXT-NINE, BP-34: no pick, no other model shown in its collection.
      pairs: [],
    } satisfies Sheet);
    // A RESERVED or HIDDEN model, an unknown or malformed address: one 404, never cached.
    for (const slug of ['zenith', 'nope', 'Not an address', '-x']) {
      const r = await h.client().get(`/api/v1/lookbook/${encodeURIComponent(slug)}`);
      expect([r.statusCode, errorOf(r).code], slug).toEqual([404, 'LOOKBOOK_NOT_FOUND']);
      expect(r.headers['cache-control'], slug).toBe('no-store');
    }
    expect(errorOf(await h.client().get(`/api/v1/lookbook/${'a'.repeat(129)}`)).code).toBe('BAD_REQUEST');
  });

  it('says a typed model\'s offered sizes only on its card and its sheet: a size set aside leaves the SIZES line (NEXT LOT §3.3)', async () => {
    const operatorActor = { type: 'admin' as const, id: (await h.ctx.db.selectFrom('admin_users').select('id').where('role', '=', 'OPERATOR').executeTakeFirstOrThrow()).id };
    const halo = (await h.ctx.services.catalog.createModel({ categoryCode: 'J', name: 'HALO', type: 'RING', skuPrefix: 'LB-HALO', sizeType: 'RING' }, operatorActor)).id;
    await h.ctx.services.sizes.declare(halo, { ticked: ['50', '52', '54'] }, operatorActor);
    expect((await patch(halo, { slug: 'halo-sized', lookbook: 'PUBLIC' })).statusCode).toBe(200);
    const sheetSizes = async () => (safeJson(await h.client().get('/api/v1/lookbook/halo-sized')) as { sizes: string[] }).sizes;
    expect(await sheetSizes()).toEqual(['50', '52', '54']);
    const s52 = (await h.ctx.db.selectFrom('skus').select('id').where('model_id', '=', halo).where('size_label', '=', '52').executeTakeFirstOrThrow()).id;
    await h.ctx.db.updateTable('skus').set({ shopify_variant_id: '5252' }).where('id', '=', s52).execute();
    expect(await h.ctx.services.sizes.removeSize(halo, s52, operatorActor)).toEqual({ outcome: 'SET_ASIDE' });
    expect(await sheetSizes()).toEqual(['50', '54']);
    expect(((await publicList()).find((c) => c.slug === 'halo-sized') as unknown as { sizes: string[] }).sizes).toEqual(['50', '54']);
    expect((await patch(halo, { lookbook: 'HIDDEN' })).statusCode).toBe(200);
  });

  it('names the sheet of a PUBLIC model on the AUTHENTIC results of its pieces, never a RESERVED one, never on another result', async () => {
    const verify = async (code: string) => safeJson(await h.client().post('/api/v1/verify', { code })) as { state: string; product?: { lookbook?: string } };
    expect((await verify(piece.code.data)).product?.lookbook).toBe('monolithe-ring');
    expect((await patch(catalog.modelId, { lookbook: 'RESERVED' })).statusCode).toBe(200);
    expect((await verify(piece.code.data)).product).not.toHaveProperty('lookbook');
    expect((await patch(catalog.modelId, { lookbook: 'PUBLIC' })).statusCode).toBe(200);
    // A revoked piece shows no product, so no lookbook either.
    const revoked = await issue(h.ctx, catalog);
    await h.ctx.services.lifecycle.transition(revoked.product.productId, 'REVOKED', { reason: 'test' }, SYSTEM_ACTOR);
    const r = await h.client().post('/api/v1/verify', { code: revoked.code.data });
    expect((safeJson(r) as { state: string }).state).toBe('REVOKED');
    expect(r.body).not.toContain('monolithe-ring');
  });

  it('the club: the RESERVED models for an account that holds a piece now (401 signed out, 403 OWNERS_ONLY without a piece), never stored', async () => {
    const anonymous = await h.client().get('/api/v1/club/lookbook');
    expect([anonymous.statusCode, errorOf(anonymous).code]).toEqual([401, 'UNAUTHORIZED']);
    const { client: stranger } = await accountClient(h);
    for (const url of ['/api/v1/club/lookbook', '/api/v1/club/lookbook/zenith']) {
      const res = await stranger.get(url);
      expect([res.statusCode, errorOf(res)], url).toEqual([403, { code: 'OWNERS_ONLY', message: 'This is reserved for the owners of an ORBES piece.' }]);
      expect(res.headers['cache-control']).toBe('no-store');
    }

    const { client: owner, email } = await accountClient(h);
    const held = await ownedPiece(owner);
    const ownerId = (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email.toLowerCase()).executeTakeFirstOrThrow()).id;
    expect(await h.ctx.services.club.activePieces(ownerId)).toBe(1);
    const list = await owner.get('/api/v1/club/lookbook');
    expect(list.statusCode, list.body).toBe(200);
    expect(list.headers['cache-control']).toBe('no-store');
    expect((safeJson(list) as { models: Card[] }).models.map((c) => [c.slug, c.collection])).toEqual([['zenith', 'NOCTURNE II']]);
    expect(list.body).not.toContain('For the owners.');
    const sheet = await owner.get('/api/v1/club/lookbook/zenith');
    expect(sheet.statusCode).toBe(200);
    expect(safeJson(sheet)).toMatchObject({ slug: 'zenith', lookbook: 'RESERVED', story: 'For the owners.', gallery: [], specs: [], care: null });
    // A PUBLIC sheet too; a HIDDEN or unknown model is the same 404.
    expect((safeJson(await owner.get('/api/v1/club/lookbook/aurore')) as Sheet).lookbook).toBe('PUBLIC');
    const eclipse = (await h.ctx.db.selectFrom('models').select('id').where('name', '=', 'ECLIPSE').executeTakeFirstOrThrow()).id;
    expect((await patch(eclipse, { lookbook: 'HIDDEN' })).statusCode).toBe(200);
    for (const slug of ['eclipse', 'nope']) expect(errorOf(await owner.get(`/api/v1/club/lookbook/${slug}`)).code, slug).toBe('LOOKBOOK_NOT_FOUND');

    // The access goes with the last piece: a piece revoked by ORBES no longer counts (its ownership stays open).
    await h.ctx.services.lifecycle.transition(held.product.productId, 'REVOKED', { reason: 'test' }, SYSTEM_ACTOR);
    expect(errorOf(await owner.get('/api/v1/club/lookbook')).code).toBe('OWNERS_ONLY');
    expect(await h.ctx.services.club.activePieces(ownerId)).toBe(0);
    expect(await h.ctx.db.selectFrom('ownership').select('id').where('account_id', '=', ownerId).where('ended_at', 'is', null).execute()).toHaveLength(1);
  });

  it('the club reads by GET and changes nothing but by POST: every route of routes/club.ts is one of the two, under /api/v1/club/', () => {
    const source = readDoc('genome/src/server/routes/club.ts');
    const routes = [...source.matchAll(/\bapp\.(\w+)\(\s*'([^']+)'/g)].map((m) => [m[1]!, m[2]!] as const).filter(([method]) => method !== 'addHook');
    expect(routes.map(([method, path]) => `${method} ${path}`)).toEqual(expect.arrayContaining(['get /api/v1/club/lookbook', 'get /api/v1/club/lookbook/:slug']));
    for (const [method, path] of routes) {
      expect(['get', 'post'], `${method} ${path}`).toContain(method);
      expect(path, `${method} ${path}`).toMatch(/^\/api\/v1\/club\//);
    }
    // No other way to declare a route there (app.route, app.all, a PUT, PATCH or DELETE).
    expect(source).not.toMatch(/\bapp\.(route|all|put|patch|delete|head|options)\(/);
  });

  it('serves the photographs on their own budget, five times the api one (a sheet shows up to nine)', async () => {
    const budgets = await createHarness({ config: { rateLimits: { apiPerMinute: 3 } } });
    try {
      const c = budgets.client({ ip: '198.51.100.30' });
      const missing = `/api/v1/media/${'ab'.repeat(32)}`;
      const first = await c.get(missing);
      expect(first.statusCode).toBe(404);
      expect(first.headers['x-ratelimit-limit']).toBe(String(3 * MEDIA_RATE_FACTOR));
      for (let i = 0; i < 6; i++) expect((await c.get(missing)).statusCode).toBe(404);
      // The api budget is apart: the lookbook still answers.
      const listed = await c.get('/api/v1/lookbook');
      expect([listed.statusCode, listed.headers['x-ratelimit-limit']]).toEqual([200, '3']);
    } finally {
      await budgets.close();
    }
  });
});

/**
 * THE RELEASES OF THIS MODEL (plan NEXT-NINE of 2026-10-06, §3.6 CO-01): a sheet's `releases`, the past releases of its
 * model's whole group by THE RELEASES' PAST's rule (services/past-releases.ts modelReleases), each exactly its id, kind,
 * opening and variant, the newest first; the same through the club and from any dot's address.
 */
describe('THE RELEASES OF THIS MODEL (plan NEXT-NINE, CO-01): a sheet\'s past releases', () => {
  const START = Date.parse('2026-11-02T09:00:00.000Z');
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  let h: Harness;
  let f: LiveFixture;
  let main: string;
  let blue: string;
  let other: string;
  let alone: string;
  const ids: Record<string, string> = {};

  interface Release {
    id: string;
    kind: string;
    opensAt: string;
    variant: string | null;
  }
  const releasesOf = async (slug: string, c?: Client): Promise<Release[]> => {
    const res = await (c ?? h.client()).get(c ? `/api/v1/club/lookbook/${slug}` : `/api/v1/lookbook/${slug}`);
    expect(res.statusCode, res.body).toBe(200);
    return (safeJson(res) as { releases: Release[] }).releases;
  };

  /** A draw of `modelId` opening at `opens` (from START), published unless `draft`; drawn once its entries close when `drawn`. */
  async function draw(key: string, modelId: string, opens: number, o: { drawn?: boolean; draft?: boolean; cancel?: boolean; closes?: number } = {}): Promise<string> {
    h.clock.set(new Date(START + opens - HOUR));
    const d = await f.drops.create({ modelId, title: `DRAW ${key}`, quantity: 2, opensAt: new Date(START + opens), closesAt: new Date(START + (o.closes ?? opens + HOUR)), earlyAccessHours: 0 }, f.admin);
    if (!o.draft) await f.drops.publish(d.id, f.admin);
    if (o.cancel) await f.drops.cancel(d.id, f.admin);
    if (o.drawn) {
      h.clock.set(new Date(START + (o.closes ?? opens + HOUR) + MINUTE));
      await f.drops.draw(d.id, f.admin);
    }
    ids[key] = d.id;
    return d.id;
  }

  /** A LIVE RELEASE of `modelId` opening at `opens` (from START); `end`: ended by ORBES at its close, `early`: before its room. */
  async function live(key: string, modelId: string, opens: number, end: 'close' | 'early' | 'held' | null, afterRoom = false): Promise<string> {
    h.clock.set(new Date(START + opens - 2 * HOUR));
    const r = await createLiveRelease(f, {
      modelId,
      opensAt: new Date(START + opens),
      closesAt: new Date(START + opens + HOUR),
      quantityLine: '25 PIECES',
      ...(afterRoom ? { afterRoom: { modelId: main, priceMinor: 90_000, sizes: [{ label: 'ONE SIZE', stock: 1 }] } } : {}),
    });
    if (r.afterRoom) ids.afterRoom = r.afterRoom.id;
    if (end === 'early') {
      // Its name revealed only an hour before it opens: ended by ORBES before then, it is named nowhere.
      await h.ctx.db.updateTable('drops').set({ name_at: new Date(START + opens - HOUR), photo_at: new Date(START + opens - HOUR) }).where('id', '=', r.id).execute();
      await f.live.end(r.id, f.admin);
    } else if (end === 'held') {
      // A piece secured, not confirmed, when ORBES ends it: its hold still runs.
      const who = await createAccount(h.ctx.db);
      h.clock.set(new Date(START + opens - MINUTE));
      await f.live.enter(who.id, r.id, { sizeId: r.sizes[0]!.id }, who.actor);
      h.clock.set(new Date(START + opens));
      await f.live.advance(r.id);
      h.clock.advance(2000);
      const token = (await f.live.entry(who.id, r.id))!.turn!.token!;
      await f.live.press(who.id, r.id, token);
      h.clock.advance(1500);
      await f.live.secure(who.id, r.id, token, who.actor);
      await f.live.end(r.id, f.admin);
    } else if (end === 'close') {
      h.clock.set(new Date(START + opens + HOUR + MINUTE));
      await f.live.advance(r.id);
    }
    ids[key] = r.id;
    return r.id;
  }

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(new Date(START - 30 * DAY));
    f = await liveFixtureOn(h.ctx, h.clock);
    const catalog = h.ctx.services.catalog;
    main = (await catalog.createModel({ categoryCode: 'J', name: 'HALO', type: 'RING', skuPrefix: 'HAL-ST' }, f.admin)).id;
    await catalog.updateModel(main, { lookbook: 'PUBLIC', slug: 'halo' }, f.admin);
    blue = (await catalog.createVariant(main, { label: 'Blue', swatch: '#16224A', skuPrefix: 'HAL-BL', mainLabel: 'Steel', mainSwatch: '#9D9B96' }, f.admin)).id;
    // A variant kept HIDDEN: its releases are the model's all the same (a past release is public).
    const gold = (await catalog.createVariant(main, { label: 'Gold', swatch: '#B88A3A', skuPrefix: 'HAL-GD' }, f.admin)).id;
    await catalog.updateModel(blue, { lookbook: 'PUBLIC', slug: 'halo-blue' }, f.admin);
    other = (await catalog.createModel({ categoryCode: 'J', name: 'ZENITH', type: 'RING', skuPrefix: 'ZEN-ST' }, f.admin)).id;
    await catalog.updateModel(other, { lookbook: 'PUBLIC', slug: 'zenith' }, f.admin);
    alone = (await catalog.createModel({ categoryCode: 'J', name: 'ORBIT', type: 'RING', skuPrefix: 'ORB-ST' }, f.admin)).id;
    await catalog.updateModel(alone, { lookbook: 'PUBLIC', slug: 'orbit' }, f.admin);
    await catalog.createModel({ categoryCode: 'J', name: 'NEVER', type: 'RING', skuPrefix: 'NEV-ST' }, f.admin).then((m) => catalog.updateModel(m.id, { lookbook: 'PUBLIC', slug: 'never' }, f.admin));

    // Shown: a drawn draw of each dot, two LIVE RELEASES ended (one sold through its hold), the model alone's drawn draw.
    await draw('drawnSteel', main, 1 * DAY, { drawn: true });
    await draw('drawnGold', gold, 3 * DAY, { drawn: true });
    await live('liveBlue', blue, 5 * DAY, 'close');
    await live('liveSteel', main, 7 * DAY, 'close', true);
    await draw('drawnAlone', alone, 2 * DAY, { drawn: true });
    // Never shown: an open draw, a closed one not drawn, a cancelled one, a draft; a LIVE RELEASE still to come, one
    // running, one ended before its name stage, one whose hold still runs; an after-room; another model's draw.
    await draw('open', main, 8 * DAY, { closes: 20 * DAY });
    await draw('closed', main, 6 * DAY);
    await draw('cancelled', main, 4 * DAY, { cancel: true });
    await draw('draft', main, 4 * DAY + HOUR, { draft: true });
    await live('early', blue, 9 * DAY, 'early');
    await live('coming', main, 30 * DAY, null);
    await draw('otherDrawn', other, 2 * DAY + HOUR, { drawn: true });
    // Last, at the same opening, so the clock stays inside the hold: one running, one ended with its hold still running.
    await live('running', blue, 12 * DAY, null);
    await live('held', main, 12 * DAY, 'held');
    await f.live.advance(ids.running!);
    // The steel LIVE RELEASE's after-room, of the model too, ended: hidden even after its release (decision 28).
    await h.ctx.db.updateTable('drops').set({ published_at: h.clock.now(), ended_at: h.clock.now(), ended_reason: 'CLOSED' }).where('id', '=', ids.afterRoom!).execute();
  });
  afterAll(() => h?.close());

  it('lists the past releases of the model and every variant, the newest first, each with its label; never one still to come, cancelled, a draft, an after-room nor another model\'s', async () => {
    const list = await releasesOf('halo');
    expect(list.map((r) => r.id)).toEqual([ids.liveSteel, ids.liveBlue, ids.drawnGold, ids.drawnSteel]);
    expect(list.map((r) => [r.kind, r.variant])).toEqual([
      ['LIVE', 'Steel'],
      ['LIVE', 'Blue'],
      ['DRAW', 'Gold'],
      ['DRAW', 'Steel'],
    ]);
    expect(list.map((r) => r.opensAt)).toEqual([7, 5, 3, 1].map((d) => new Date(START + d * DAY).toISOString()));
    for (const key of ['open', 'closed', 'cancelled', 'draft', 'early', 'held', 'coming', 'running', 'otherDrawn', 'afterRoom']) expect(list.map((r) => r.id), key).not.toContain(ids[key]);
    expect((await releasesOf('zenith')).map((r) => r.id)).toEqual([ids.otherDrawn]);
  });

  it('gives each release exactly {id, kind, opensAt, variant}: no title, no quantity, no end figure', async () => {
    for (const r of await releasesOf('halo')) expect(Object.keys(r).sort()).toEqual(['id', 'kind', 'opensAt', 'variant']);
    const res = await h.client().get('/api/v1/lookbook/halo');
    for (const word of ['DRAW drawnSteel', '25 PIECES', 'quantity', 'endedReason', 'SOLD_OUT', 'title']) expect(res.body, word).not.toContain(word);
  });

  it('says variant null for a model alone, and nothing for a model never released', async () => {
    expect(await releasesOf('orbit')).toEqual([{ id: ids.drawnAlone, kind: 'DRAW', opensAt: new Date(START + 2 * DAY).toISOString(), variant: null }]);
    expect(await releasesOf('never')).toEqual([]);
  });

  it('gives the same list from a variant\'s address and through the club, and keeps the hold\'s release out until it is over', async () => {
    const list = await releasesOf('halo');
    expect(await releasesOf('halo-blue')).toEqual(list);
    const { client, email } = await accountClient(h);
    const owner = await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email.toLowerCase()).executeTakeFirstOrThrow();
    await holdPieces(h.ctx.db, owner.id, 1, other);
    expect(await releasesOf('halo', client)).toEqual(list);
    expect(await releasesOf('halo-blue', client)).toEqual(list);
    // The hold confirmed: that release ended, it is listed (the newest).
    const held = await h.ctx.db.selectFrom('live_entries').select('account_id').where('drop_id', '=', ids.held!).where('status', '=', 'SECURED').executeTakeFirstOrThrow();
    await f.live.confirm(held.account_id, ids.held!, { type: 'account', id: held.account_id });
    expect((await releasesOf('halo')).map((r) => r.id)).toEqual([ids.held, ...list.map((r) => r.id)]);
  });
});

/**
 * PAIRS WELL WITH (plan NEXT-NINE of 2026-10-06, §3.7 BP-34): a sheet's `pairs`, the very last section's models
 * (services/lookbook.ts pairsOf): the main model's picks in their order, each the reader may see, never discontinued;
 * else up to three models of its collection, one per variant group, never its own, the latest published first; the same
 * from a variant's address; each card exactly {slug, name, type, variant, imageUrl, reserved}, never a price.
 */
describe('PAIRS WELL WITH (plan NEXT-NINE, BP-34): a sheet\'s last section', () => {
  let h: Harness;
  let f: LiveFixture;
  const m: Record<string, string> = {};
  let titane: Client;
  let palladium: Client;

  interface Pair {
    slug: string;
    name: string;
    type: string;
    variant: string | null;
    imageUrl: string | null;
    reserved: boolean;
  }
  const pairsOf = async (slug: string, c?: Client): Promise<Pair[]> => {
    const res = await (c ?? h.client()).get(c ? `/api/v1/club/lookbook/${slug}` : `/api/v1/lookbook/${slug}`);
    expect(res.statusCode, `${slug} ${res.body.slice(0, 200)}`).toBe(200);
    return (safeJson(res) as { pairs: Pair[] }).pairs;
  };
  const slugs = (list: Pair[]) => list.map((p) => p.slug);
  const pick = (model: string, ids: string[]) => h.ctx.services.catalog.setPairs(m[model]!, ids.map((k) => m[k]!), f.admin);

  /** A model of `collection` shown as `lookbook` at the next minute (its publication's time orders the fallback). */
  async function model(key: string, name: string, collection: string | null, lookbook: 'PUBLIC' | 'RESERVED' | 'HIDDEN', extra: Record<string, unknown> = {}): Promise<string> {
    h.clock.advance(60_000);
    const catalog = h.ctx.services.catalog;
    const id = (await catalog.createModel({ categoryCode: 'J', collectionId: collection, name, type: 'BRACELET', skuPrefix: `PW-${key.toUpperCase()}` }, f.admin)).id;
    await catalog.updateModel(id, { lookbook, ...(lookbook === 'HIDDEN' ? {} : { slug: key }), ...extra }, f.admin);
    m[key] = id;
    return id;
  }

  async function owner(pieces: number): Promise<Client> {
    const { client, email } = await accountClient(h);
    const a = await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email.toLowerCase()).executeTakeFirstOrThrow();
    await holdPieces(h.ctx.db, a.id, pieces, f.modelId);
    return client;
  }

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(new Date('2026-09-01T09:00:00.000Z'));
    f = await liveFixtureOn(h.ctx, h.clock);
    const orbital = await createCollection(h.ctx.db, 'ORBITAL');
    const other = await createCollection(h.ctx.db, 'SATURN');
    await model('halo', 'HALO', orbital, 'PUBLIC');
    m.haloBlue = (await h.ctx.services.catalog.createVariant(m.halo!, { label: 'Blue', swatch: '#16224A', skuPrefix: 'PW-HALOBL', mainLabel: 'Steel', mainSwatch: '#9D9B96' }, f.admin)).id;
    await h.ctx.services.catalog.updateModel(m.haloBlue, { lookbook: 'PUBLIC', slug: 'halo-blue' }, f.admin);
    await model('zenith', 'ZENITH', orbital, 'RESERVED', { privateMinTier: 1, priceLabel: '€ 4 800' });
    await model('orbit', 'ORBIT', orbital, 'PUBLIC');
    m.orbitGold = (await h.ctx.services.catalog.createVariant(m.orbit!, { label: 'Gold', swatch: '#B88A3A', skuPrefix: 'PW-ORBGD', mainLabel: 'Steel', mainSwatch: '#9D9B96' }, f.admin)).id;
    h.clock.advance(60_000);
    await h.ctx.services.catalog.updateModel(m.orbitGold, { lookbook: 'PUBLIC', slug: 'orbit-gold' }, f.admin);
    await model('nocturne', 'NOCTURNE', orbital, 'HIDDEN');
    await model('eclipse', 'ECLIPSE', orbital, 'PUBLIC');
    await h.ctx.services.catalog.discontinueModel(m.eclipse!, f.admin);
    await model('pallas', 'PALLAS', orbital, 'RESERVED', { privateMinTier: 3 });
    await model('aura', 'AURA', orbital, 'PUBLIC');
    await model('star', 'STAR', other, 'PUBLIC');
    m.starRed = (await h.ctx.services.catalog.createVariant(m.star!, { label: 'Red', swatch: '#8A1F1F', skuPrefix: 'PW-STARRD', mainLabel: 'Steel', mainSwatch: '#9D9B96' }, f.admin)).id;
    await h.ctx.services.catalog.updateModel(m.starRed, { lookbook: 'PUBLIC', slug: 'star-red' }, f.admin);
    await model('lone', 'LONE', null, 'PUBLIC');
    // Photographs: STAR in red its reference photograph; AURA only a gallery photograph (its card takes the first).
    await h.ctx.services.media.setModelImage(m.starRed, { mime: 'image/jpeg', bytes: jpegPhoto(400, 400) }, f.admin);
    await h.ctx.services.media.addModelGalleryImage(m.aura!, { mime: 'image/jpeg', bytes: jpegPhoto(300, 300) }, f.admin);
    titane = await owner(1);
    palladium = await owner(10);
  });
  afterAll(() => h?.close());

  it('none picked: up to three models of its collection the reader may see, one per group, never its own, the latest published first', async () => {
    // Signed out: the PUBLIC ones (ZENITH and PALLAS reserved, NOCTURNE hidden, ECLIPSE discontinued, HALO its own).
    expect(slugs(await pairsOf('halo'))).toEqual(['aura', 'orbit']);
    // ORBIT and its gold variant are one card, led by the main model; its own group never, from a variant's address too.
    expect(await pairsOf('halo-blue')).toEqual(await pairsOf('halo'));
    // An owner: THE PRIVATE SALON from its tier (ZENITH from TITANE, PALLAS from PALLADIUM); at most three.
    expect(slugs(await pairsOf('halo', titane))).toEqual(['aura', 'orbit', 'zenith']);
    expect(slugs(await pairsOf('halo', palladium))).toEqual(['aura', 'pallas', 'orbit']);
    const zenith = (await pairsOf('halo', titane)).find((p) => p.slug === 'zenith')!;
    expect(zenith).toEqual({ slug: 'zenith', name: 'ZENITH', type: 'BRACELET', variant: null, imageUrl: null, reserved: true });
    // The fallback of a model of the other collection: its own group never, nothing else there.
    expect(await pairsOf('star-red')).toEqual([]);
    // No collection and no pick: none.
    expect(await pairsOf('lone')).toEqual([]);
  });

  it('the picks in their order, each the reader may see: a picked variant by its own address and label, a hidden or discontinued one never', async () => {
    await pick('halo', ['starRed', 'zenith', 'nocturne']);
    const out = await pairsOf('halo');
    expect(out).toEqual([{ slug: 'star-red', name: 'STAR', type: 'BRACELET', variant: 'Red', imageUrl: expect.stringMatching(/^\/api\/v1\/media\/[0-9a-f]{64}$/), reserved: false }]);
    for (const p of out) expect(Object.keys(p).sort()).toEqual(['imageUrl', 'name', 'reserved', 'slug', 'type', 'variant']);
    expect(slugs(await pairsOf('halo', titane))).toEqual(['star-red', 'zenith']);
    // The same from a variant's address (its sheet is its main model's).
    expect(await pairsOf('halo-blue', titane)).toEqual(await pairsOf('halo', titane));
    // A main model picked reads without a variant; a discontinued pick never shows.
    await pick('halo', ['orbit', 'eclipse', 'aura']);
    const second = await pairsOf('halo');
    expect(second.map((p) => [p.slug, p.variant])).toEqual([
      ['orbit', null],
      ['aura', null],
    ]);
    // AURA's card takes the first photograph of its gallery.
    expect(second[1]!.imageUrl).toMatch(/^\/api\/v1\/media\/[0-9a-f]{64}$/);
    expect((await h.client().get('/api/v1/lookbook/halo')).body).not.toContain('price');
  });

  it('a RESERVED pick only through the club from its tier; every pick the reader may not see: the fallback', async () => {
    await pick('halo', ['pallas', 'zenith']);
    expect(slugs(await pairsOf('halo', palladium))).toEqual(['pallas', 'zenith']);
    expect(slugs(await pairsOf('halo', titane))).toEqual(['zenith']);
    // Signed out, neither shows: the collection's models instead.
    expect(slugs(await pairsOf('halo'))).toEqual(['aura', 'orbit']);
    await pick('halo', ['nocturne', 'eclipse']);
    expect(slugs(await pairsOf('halo'))).toEqual(['aura', 'orbit']);
    await pick('halo', []);
  });
});
