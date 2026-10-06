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
      await operator.post('/api/admin/models', { categoryCode: 'J', name, type: 'PENDANT', skuPrefix: `LB-${name.slice(0, 6)}`, ...(col ? { collectionId: col } : {}) }),
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
    // The list and the one model answer alike.
    const listed = (safeJson(await auditor.get('/api/admin/models')) as { items: ModelJson[] }).items.find((x) => x.id === catalog.modelId);
    expect(listed).toEqual(m);
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
    for (const c of models) expect(Object.keys(c).sort()).toEqual(['category', 'collection', 'imageUrl', 'name', 'slug', 'type', 'variant', 'variants']);
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
    } satisfies Sheet);
    // A RESERVED or HIDDEN model, an unknown or malformed address: one 404, never cached.
    for (const slug of ['zenith', 'nope', 'Not an address', '-x']) {
      const r = await h.client().get(`/api/v1/lookbook/${encodeURIComponent(slug)}`);
      expect([r.statusCode, errorOf(r).code], slug).toEqual([404, 'LOOKBOOK_NOT_FOUND']);
      expect(r.headers['cache-control'], slug).toBe('no-store');
    }
    expect(errorOf(await h.client().get(`/api/v1/lookbook/${'a'.repeat(129)}`)).code).toBe('BAD_REQUEST');
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
