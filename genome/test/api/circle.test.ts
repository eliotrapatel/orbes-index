/**
 * The owners' circle (P-X01):
 *
 *  - the console (/api/admin/circle/posts, OPERATOR; an AUDITOR reads): a
 *    NOTE, an INVITATION or a POLL with the fields of its kind and of no
 *    other, its tier, its links (a drop, a model, an https address on the
 *    hosts of the code's list only); changed (never its kind; a poll's
 *    options until the first vote, an invitation's capacity never under its
 *    YES), published, withdrawn, each audited (the body as its length and
 *    SHA-256); its photographs (4 at most, ordered, described, removed and
 *    deleted once unused); the answers with the emails masked for an AUDITOR;
 *  - the members (/api/v1/club/circle…): a signed-in account that holds a
 *    piece now (403 OWNERS_ONLY otherwise, read again at each request); a post
 *    from its tier up only (404 below it, unpublished or unknown); the feed
 *    paginated, without bodies, the latest first; an answer YES or NO under
 *    the post's lock, within its capacity, until the event (audited); a vote,
 *    once and final, its results shown after it (never audited); no-store;
 *  - the visits counted per day on the feed's first page, with no account;
 *    the Analytics panel: the members by tier now, the visits by day;
 *  - the right-of-access export: the account's answers and votes.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CIRCLE_LINK_HOSTS, circleLinkHost, normalizeCircleUrl } from '../../src/server/services/circle.js';
import type { IssueResult } from '../../src/server/services/issuance.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { jpegPhoto } from '../support/images.js';
import { accountClient, adminClient, createHarness, errorOf, issue, safeJson, scanToReceive, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

const HOUR = 3_600_000;

interface PhotoJson {
  sha256: string;
  url: string;
  alt: string | null;
  position: number;
}

interface AdminPostJson {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  minTier: number;
  eventAt: string | null;
  eventPlace: string | null;
  capacity: number | null;
  pollOptions: string[] | null;
  drop: { id: string; title: string; state: string } | null;
  model: { id: string; name: string; type: string; lookbook: string; slug: string | null } | null;
  externalUrl: string | null;
  published: boolean;
  publishedAt: string | null;
  createdBy: { id: string; email: string } | null;
  photos: PhotoJson[];
  answers: { YES: number; NO: number };
  results: { counts: number[]; total: number } | null;
}

interface CardJson {
  id: string;
  kind: string;
  title: string;
  minTier: number;
  publishedAt: string;
  cover: { url: string; alt: string | null } | null;
  eventAt: string | null;
  eventPlace: string | null;
  answer: 'YES' | 'NO' | null;
  voted: boolean;
}

interface PostJson extends CardJson {
  body: string | null;
  photos: { url: string; alt: string | null }[];
  invitation: { eventAt: string; place: string | null; capacity: number | null; placesLeft: number | null; open: boolean } | null;
  poll: { options: string[]; vote: number | null; results: { counts: number[]; total: number } | null } | null;
  links: { drop: { id: string; title: string } | null; model: { slug: string; name: string; type: string } | null; external: { url: string; host: string } | null };
}

describe('the owners\' circle (P-X01)', () => {
  let h: Harness;
  let catalog: Catalog;
  let operator: Client;
  let auditor: Client;
  let admin: Client;

  const posts = (id = '') => `/api/admin/circle/posts${id ? `/${id}` : ''}`;
  const audits = (action: string, targetId?: string) =>
    h.ctx.db.selectFrom('audit_logs').selectAll().where('action', '=', action).$if(targetId !== undefined, (q) => q.where('target_id', '=', targetId!)).orderBy('id').execute();
  const accountIdOf = async (email: string) =>
    (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email.toLowerCase()).executeTakeFirstOrThrow()).id;
  const at = (offsetMs: number) => new Date(h.clock.now().getTime() + offsetMs).toISOString();
  const upload = (c: Client, url: string, bytes: Uint8Array) => c.request('POST', url, { body: Buffer.from(bytes), headers: { 'content-type': 'image/jpeg' } });

  /** Fresh console clients (a console session lasts 8 hours). */
  async function staff(): Promise<void> {
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    admin = await adminClient(h, 'ADMIN');
  }

  /** A piece registered to the customer behind `c`, through a scan and its registration token. */
  async function ownedPiece(c: Client): Promise<IssueResult> {
    const p = await issue(h.ctx, catalog);
    await h.ctx.services.warranty.activate(p.product.productId, { retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    const scan = safeJson(await c.post('/api/v1/verify', { code: p.code.data })) as { registration: { token: string } };
    expect((await c.post('/api/v1/ownership/register', { registrationToken: scan.registration.token })).statusCode).toBe(201);
    return p;
  }

  /** A signed-in account holding `pieces` pieces now. */
  async function member(pieces: number): Promise<{ client: Client; email: string; id: string; pieces: IssueResult[] }> {
    const a = await accountClient(h);
    const held: IssueResult[] = [];
    for (let i = 0; i < pieces; i++) held.push(await ownedPiece(a.client));
    return { ...a, id: await accountIdOf(a.email), pieces: held };
  }

  async function create(body: Record<string, unknown>, c: Client = operator): Promise<AdminPostJson> {
    const res = await c.post(posts(), { kind: 'NOTE', title: 'A note from the atelier', ...body });
    expect(res.statusCode, res.body).toBe(201);
    return safeJson(res) as AdminPostJson;
  }

  const publish = async (id: string) => {
    const res = await operator.post(`${posts(id)}/publish`);
    expect(res.statusCode, res.body).toBe(200);
    return safeJson(res) as AdminPostJson;
  };

  const feed = async (c: Client, query = '') => {
    const res = await c.get(`/api/v1/club/circle${query}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    return safeJson(res) as { items: CardJson[]; page: number; pageSize: number; total: number };
  };

  const read = async (c: Client, id: string) => {
    const res = await c.get(`/api/v1/club/circle/${id}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    return safeJson(res) as PostJson;
  };

  const visits = async () => (await h.ctx.db.selectFrom('circle_daily_visits').selectAll().orderBy('day').execute()).map((r) => [r.day, r.visits]);

  beforeAll(async () => {
    h = await createHarness();
    catalog = await seedCatalog(h.ctx);
    await staff();
  });
  afterAll(() => h?.close());

  it('keeps a post\'s link to https on the code\'s hosts and their subdomains, and names the host shown beside it', () => {
    expect([...CIRCLE_LINK_HOSTS]).toEqual(['theorbes.com', 'youtube.com', 'vimeo.com']);
    expect(normalizeCircleUrl('https://www.youtube.com/watch?v=abc')).toBe('https://www.youtube.com/watch?v=abc');
    expect(normalizeCircleUrl(' https://player.vimeo.com/video/1 ')).toBe('https://player.vimeo.com/video/1');
    expect(normalizeCircleUrl('https://THEORBES.com')).toBe('https://theorbes.com/');
    expect(normalizeCircleUrl('')).toBeNull();
    expect(normalizeCircleUrl(null)).toBeNull();
    for (const bad of [
      'http://youtube.com/watch',
      'https://youtube.com.example.com/',
      'https://notyoutube.com/',
      'https://user:pass@theorbes.com/',
      'https://theorbes.com:8443/',
      'javascript:alert(1)',
      'https://theorbes.com/a b',
      'youtube.com/watch',
      `https://theorbes.com/${'x'.repeat(490)}`,
    ]) {
      expect(() => normalizeCircleUrl(bad), bad).toThrow();
    }
    expect(circleLinkHost('https://www.youtube.com/watch?v=abc')).toBe('youtube.com');
    expect(circleLinkHost('https://player.vimeo.com/video/1')).toBe('player.vimeo.com');
    expect(circleLinkHost('not a url')).toBeNull();
  });

  it('creates a note, an invitation and a poll with the fields of their kind only, their links checked, audited without the body\'s words', async () => {
    const bad = async (body: Record<string, unknown>, status = 400, code = 'VALIDATION_FAILED') => {
      const res = await operator.post(posts(), { kind: 'NOTE', title: 'X', ...body });
      expect([res.statusCode, errorOf(res).code], JSON.stringify(body)).toEqual([status, code]);
    };
    await bad({ kind: 'NEWS' });
    await bad({ title: '' });
    await bad({ title: 'x'.repeat(121) });
    await bad({ body: 'x'.repeat(6001) });
    await bad({ minTier: 0 });
    await bad({ minTier: 4 });
    await bad({ eventAt: at(HOUR) });
    await bad({ capacity: 3 });
    await bad({ pollOptions: ['A', 'B'] });
    await bad({ kind: 'INVITATION' });
    await bad({ kind: 'INVITATION', eventAt: at(HOUR), pollOptions: ['A', 'B'] });
    await bad({ kind: 'INVITATION', eventAt: at(HOUR), capacity: 0 });
    await bad({ kind: 'POLL' });
    await bad({ kind: 'POLL', pollOptions: ['Only one'] });
    await bad({ kind: 'POLL', pollOptions: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] });
    await bad({ kind: 'POLL', pollOptions: ['Paris', 'paris'] });
    await bad({ kind: 'POLL', pollOptions: ['Paris', 'x'.repeat(41)] });
    await bad({ kind: 'POLL', pollOptions: ['A', 'B'], eventPlace: 'Paris' });
    await bad({ externalUrl: 'http://youtube.com/watch?v=x' });
    await bad({ externalUrl: 'https://example.com/' });
    await bad({ dropId: 'not-a-drop' });
    await bad({ dropId: '5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6' }, 404, 'DROP_NOT_FOUND');
    await bad({ modelId: '5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6' }, 404, 'MODEL_NOT_FOUND');
    expect((await auditor.post(posts(), { kind: 'NOTE', title: 'X' })).statusCode).toBe(403);

    const note = await create({ body: 'First paragraph.\r\n\r\n\r\n  Second paragraph.  ', externalUrl: 'https://www.youtube.com/watch?v=orbes', modelId: catalog.modelId });
    expect(note).toMatchObject({
      kind: 'NOTE',
      title: 'A note from the atelier',
      body: 'First paragraph.\n\nSecond paragraph.',
      minTier: 1,
      eventAt: null,
      capacity: null,
      pollOptions: null,
      externalUrl: 'https://www.youtube.com/watch?v=orbes',
      published: false,
      publishedAt: null,
      photos: [],
      answers: { YES: 0, NO: 0 },
      results: null,
      model: { id: catalog.modelId, name: 'MONOLITHE', lookbook: 'HIDDEN' },
    });
    expect(note.createdBy?.email).toMatch(/^operator-/);
    const created = await audits('circle.post.create', note.id);
    expect(created).toHaveLength(1);
    expect(created[0]!.details).toMatchObject({
      kind: 'NOTE',
      title: 'A note from the atelier',
      minTier: 1,
      body: { length: 35, sha256: createHash('sha256').update('First paragraph.\n\nSecond paragraph.').digest('hex') },
      externalUrl: 'https://www.youtube.com/watch?v=orbes',
    });
    expect(JSON.stringify(created[0]!.details)).not.toContain('First paragraph');

    h.clock.advance(1_000);
    const invitation = await create({ kind: 'INVITATION', title: 'Dinner at the atelier', eventAt: at(48 * HOUR), eventPlace: 'ORBES atelier, Paris', capacity: 2, minTier: 2 });
    expect(invitation).toMatchObject({ kind: 'INVITATION', minTier: 2, eventAt: at(48 * HOUR), eventPlace: 'ORBES atelier, Paris', capacity: 2 });
    h.clock.advance(1_000);
    const poll = await create({ kind: 'POLL', title: 'Where next?', pollOptions: ['Paris, at night', 'Milan', '"Tokyo"'] });
    expect(poll.pollOptions).toEqual(['Paris, at night', 'Milan', '"Tokyo"']);
    expect(poll.results).toEqual({ counts: [0, 0, 0], total: 0 });
    // The list: the latest created first, without bodies; one post, its body.
    const list = safeJson(await auditor.get(posts())) as { items: AdminPostJson[]; total: number };
    expect(list.items.slice(0, 3).map((p) => p.id)).toEqual([poll.id, invitation.id, note.id]);
    for (const p of list.items) expect(p).not.toHaveProperty('body');
    expect((safeJson(await auditor.get(posts(note.id))) as AdminPostJson).body).toBe('First paragraph.\n\nSecond paragraph.');
    expect(errorOf(await auditor.get(posts('5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6'))).code).toBe('CIRCLE_POST_NOT_FOUND');
  });

  it('changes a post, never its kind; a poll\'s options until its first vote; an invitation\'s capacity never under its YES; publishes and withdraws it', async () => {
    const note = await create({ body: 'Words.' });
    const patch = (id: string, body: unknown, c: Client = operator) => c.patch(posts(id), body);
    expect(errorOf(await patch(note.id, { kind: 'POLL' })).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await patch(note.id, {})).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await patch(note.id, { eventAt: at(HOUR) })).code).toBe('VALIDATION_FAILED');
    expect((await patch(note.id, { title: 'Y' }, auditor)).statusCode).toBe(403);
    const changed = safeJson(await patch(note.id, { title: 'A second note', body: '', minTier: 3, externalUrl: 'https://vimeo.com/1' })) as AdminPostJson;
    expect(changed).toMatchObject({ title: 'A second note', body: null, minTier: 3, externalUrl: 'https://vimeo.com/1' });
    const update = (await audits('circle.post.update', note.id))[0]!.details as { before: Record<string, unknown>; after: Record<string, unknown> };
    expect(update).toEqual({
      before: { title: 'A note from the atelier', body: { length: 6, sha256: createHash('sha256').update('Words.').digest('hex') }, minTier: 1, externalUrl: null },
      after: { title: 'A second note', body: null, minTier: 3, externalUrl: 'https://vimeo.com/1' },
    });
    // Nothing changed: nothing written.
    expect((await patch(note.id, { title: 'A second note' })).statusCode).toBe(200);
    expect(await audits('circle.post.update', note.id)).toHaveLength(1);

    // Published once, withdrawn once; each audited.
    const published = await publish(note.id);
    expect(published).toMatchObject({ published: true, publishedAt: h.clock.now().toISOString() });
    expect(errorOf(await operator.post(`${posts(note.id)}/publish`)).code).toBe('CIRCLE_ALREADY_PUBLISHED');
    const withdrawn = safeJson(await operator.post(`${posts(note.id)}/unpublish`)) as AdminPostJson;
    expect(withdrawn).toMatchObject({ published: false, publishedAt: null });
    expect(errorOf(await operator.post(`${posts(note.id)}/unpublish`)).code).toBe('CIRCLE_NOT_PUBLISHED');
    expect((await audits('circle.post.publish', note.id)).map((e) => e.details)).toEqual([{ kind: 'NOTE', minTier: 3, segmentId: null }]);
    expect((await audits('circle.post.unpublish', note.id)).map((e) => e.details)).toEqual([{ publishedAt: published.publishedAt }]);
    expect((await auditor.post(`${posts(note.id)}/publish`)).statusCode).toBe(403);

    // A poll: its options change until a vote is cast.
    const poll = await create({ kind: 'POLL', title: 'Which stone?', pollOptions: ['Onyx', 'Opal'] });
    expect((safeJson(await patch(poll.id, { pollOptions: ['Onyx', 'Opal', 'Jade'] })) as AdminPostJson).pollOptions).toEqual(['Onyx', 'Opal', 'Jade']);
    expect(errorOf(await patch(poll.id, { pollOptions: null })).code).toBe('VALIDATION_FAILED');
    await publish(poll.id);
    const voter = await member(1);
    expect((await voter.client.post(`/api/v1/club/circle/${poll.id}/vote`, { option: 2 })).statusCode).toBe(200);
    const locked = await patch(poll.id, { pollOptions: ['Onyx', 'Opal'] });
    expect([locked.statusCode, errorOf(locked).code]).toEqual([409, 'CIRCLE_POLL_VOTED']);
    expect((safeJson(await patch(poll.id, { title: 'Which stone, then?' })) as AdminPostJson).results).toEqual({ counts: [0, 0, 1], total: 1 });

    // An invitation: its capacity never under its YES.
    const invitation = await create({ kind: 'INVITATION', title: 'A visit of the atelier', eventAt: at(72 * HOUR), capacity: 3 });
    await publish(invitation.id);
    for (const m of [voter, await member(1)]) expect((await m.client.post(`/api/v1/club/circle/${invitation.id}/rsvp`, { answer: 'YES' })).statusCode).toBe(200);
    const under = await patch(invitation.id, { capacity: 1 });
    expect([under.statusCode, errorOf(under).code]).toEqual([409, 'CIRCLE_CAPACITY_BELOW']);
    expect((safeJson(await patch(invitation.id, { capacity: 2 })) as AdminPostJson).capacity).toBe(2);
    expect((safeJson(await patch(invitation.id, { capacity: null })) as AdminPostJson).capacity).toBeNull();
    expect(errorOf(await patch(invitation.id, { eventAt: null })).code).toBe('VALIDATION_FAILED');
  });

  it('opens the circle to an account that holds a piece now, each post from its tier up; the feed paginated, without bodies, never stored', async () => {
    const titane = await member(1);
    const platine = await member(3);
    const none = await accountClient(h);
    const forAll = await create({ title: 'For every owner', body: 'A long text '.repeat(400).trim() });
    const forPlatine = await create({ title: 'For PLATINE and up', minTier: 2 });
    const draft = await create({ title: 'Not yet published' });
    h.clock.advance(1_000);
    await publish(forAll.id);
    h.clock.advance(1_000);
    await publish(forPlatine.id);

    // Signed out: 401; signed in without a piece: 403 OWNERS_ONLY, every route.
    for (const [method, url, body] of [
      ['GET', '/api/v1/club/circle', undefined],
      ['GET', `/api/v1/club/circle/${forAll.id}`, undefined],
      ['POST', `/api/v1/club/circle/${forAll.id}/rsvp`, { answer: 'YES' }],
      ['POST', `/api/v1/club/circle/${forAll.id}/vote`, { option: 0 }],
    ] as const) {
      expect((await h.client().request(method, url, body ? { body } : {})).statusCode, `${method} ${url}`).toBe(401);
      const refused = await none.client.request(method, url, body ? { body } : {});
      expect([refused.statusCode, errorOf(refused).code], `${method} ${url}`).toEqual([403, 'OWNERS_ONLY']);
    }

    // TITANE reads the posts for every owner; PLATINE those for PLATINE too. The latest published first.
    expect((await feed(titane.client)).items.map((p) => p.title)).not.toContain('For PLATINE and up');
    const seen = await feed(platine.client);
    expect(seen.items.slice(0, 2).map((p) => p.id)).toEqual([forPlatine.id, forAll.id]);
    expect(seen.items.map((p) => p.id)).not.toContain(draft.id);
    // No body in the feed: a post carries it.
    for (const p of seen.items) expect(Object.keys(p).sort()).toEqual(['answer', 'cover', 'eventAt', 'eventPlace', 'id', 'kind', 'minTier', 'publishedAt', 'title', 'voted']);
    expect((await read(titane.client, forAll.id)).body).toBe(forAll.body);
    // Below its tier, unpublished, unknown or malformed: one 404.
    for (const id of [forPlatine.id, draft.id, '5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6', 'nope']) {
      const res = await titane.client.get(`/api/v1/club/circle/${id}`);
      expect([res.statusCode, errorOf(res).code], id).toEqual([404, 'CIRCLE_POST_NOT_FOUND']);
    }
    expect((await read(platine.client, forPlatine.id)).minTier).toBe(2);

    // Paginated: 20 a page by default, 50 at most.
    const total = (await feed(platine.client)).total;
    const one = await feed(platine.client, '?page=2&pageSize=1');
    expect(one).toMatchObject({ page: 2, pageSize: 1, total });
    expect(one.items.map((p) => p.id)).toEqual([forAll.id]);
    expect((await feed(platine.client)).pageSize).toBe(20);
    expect((await feed(platine.client, '?pageSize=500')).pageSize).toBe(50);

    // Read again at each request: the access goes with the last piece (revoked by ORBES, or given away).
    await h.ctx.services.lifecycle.transition(titane.pieces[0]!.product.productId, 'REVOKED', { reason: 'test' }, SYSTEM_ACTOR);
    expect(errorOf(await titane.client.get('/api/v1/club/circle')).code).toBe('OWNERS_ONLY');
    const offer = safeJson(await platine.client.post('/api/v1/ownership/transfers', { productId: platine.pieces[0]!.product.productId })) as { transferCode: string };
    expect((await none.client.post('/api/v1/ownership/transfers/accept', await scanToReceive(none.client, platine.pieces[0]!.code.data, offer.transferCode))).statusCode).toBe(200);
    // PLATINE with two pieces left is TITANE: the PLATINE post is gone for it; the recipient joins the circle.
    expect((await feed(platine.client)).items.map((p) => p.id)).not.toContain(forPlatine.id);
    expect(errorOf(await platine.client.get(`/api/v1/club/circle/${forPlatine.id}`)).code).toBe('CIRCLE_POST_NOT_FOUND');
    expect((await feed(none.client)).items.map((p) => p.id)).toContain(forAll.id);
  });

  it('shows a post\'s photographs, its links (a published drop, a model shown in the lookbook, the host of an address), and its cover in the feed', async () => {
    const m = await member(1);
    const drop = await h.ctx.services.drops.create(
      { modelId: catalog.modelId, title: 'MONOLITHE — release II', quantity: 2, opensAt: new Date(h.clock.now().getTime() + HOUR), closesAt: new Date(h.clock.now().getTime() + 3 * HOUR) },
      { type: 'admin', id: (await h.ctx.db.selectFrom('admin_users').select('id').where('role', '=', 'OPERATOR').executeTakeFirstOrThrow()).id },
    );
    const post = await create({ title: 'The new release', dropId: drop.id, modelId: catalog.modelId, externalUrl: 'https://www.youtube.com/watch?v=orbes' });
    await publish(post.id);
    // A DRAFT drop and a HIDDEN model are no links for the members; the address is, with its host.
    const before = await read(m.client, post.id);
    expect(before.links).toEqual({ drop: null, model: null, external: { url: 'https://www.youtube.com/watch?v=orbes', host: 'youtube.com' } });
    await h.ctx.services.drops.publish(drop.id, { type: 'admin', id: post.createdBy!.id });
    await h.ctx.services.catalog.updateModel(catalog.modelId, { slug: 'monolithe-circle', lookbook: 'RESERVED' }, SYSTEM_ACTOR);
    expect((await read(m.client, post.id)).links).toMatchObject({ drop: { id: drop.id, title: 'MONOLITHE — release II' }, model: { slug: 'monolithe-circle', name: 'MONOLITHE', type: 'RING' } });
    // P-X08: a RESERVED model shown from PLATINE in the private salon is no link for a TITANE member (its sheet is 404 to it).
    await h.ctx.services.catalog.updateModel(catalog.modelId, { privateMinTier: 2 }, SYSTEM_ACTOR);
    expect((await read(m.client, post.id)).links.model).toBeNull();
    await h.ctx.services.catalog.updateModel(catalog.modelId, { privateMinTier: 1 }, SYSTEM_ACTOR);
    expect((await read(m.client, post.id)).links.model).toMatchObject({ slug: 'monolithe-circle' });

    // Photographs: 4 at most, ordered, described, removed; the first is the feed's cover.
    const photos = [1, 2, 3, 4, 5].map((n) => jpegPhoto(20 + n, 20));
    for (const p of photos.slice(0, 4)) {
      const res = await upload(operator, `${posts(post.id)}/photos`, p);
      expect(res.statusCode, res.body).toBe(200);
    }
    const full = await upload(operator, `${posts(post.id)}/photos`, photos[4]!);
    expect([full.statusCode, errorOf(full).code]).toEqual([409, 'CIRCLE_PHOTOS_FULL']);
    expect((await upload(auditor, `${posts(post.id)}/photos`, photos[4]!)).statusCode).toBe(403);
    const stored = (safeJson(await auditor.get(posts(post.id))) as AdminPostJson).photos;
    expect(stored.map((p) => p.position)).toEqual([1, 2, 3, 4]);
    expect((await audits('circle.post.photo.add', post.id)).map((e) => (e.details as { position: number }).position)).toEqual([1, 2, 3, 4]);
    const [a, b, c, d] = stored;
    const arranged = await operator.patch(`${posts(post.id)}/photos`, { images: [{ sha256: b!.sha256, alt: 'The atelier at dawn' }, { sha256: a!.sha256 }, { sha256: c!.sha256 }, { sha256: d!.sha256 }] });
    expect(arranged.statusCode, arranged.body).toBe(200);
    expect((safeJson(arranged) as AdminPostJson).photos.map((p) => [p.sha256, p.alt])).toEqual([
      [b!.sha256, 'The atelier at dawn'],
      [a!.sha256, null],
      [c!.sha256, null],
      [d!.sha256, null],
    ]);
    expect(errorOf(await operator.patch(`${posts(post.id)}/photos`, { images: [{ sha256: a!.sha256 }] })).code).toBe('CIRCLE_PHOTOS_CHANGED');
    // Removed: the next move up, and the image, used nowhere else, is deleted.
    expect((await operator.request('DELETE', `${posts(post.id)}/photos/${d!.sha256}`)).statusCode).toBe(200);
    expect(await h.ctx.db.selectFrom('media_objects').select('sha256').where('sha256', '=', d!.sha256).execute()).toEqual([]);
    expect(errorOf(await operator.request('DELETE', `${posts(post.id)}/photos/${d!.sha256}`)).code).toBe('CIRCLE_PHOTO_NOT_FOUND');
    // A photograph a model's gallery uses too stays when the post lets it go.
    await h.ctx.services.media.addModelGalleryImage(catalog.modelId, { mime: 'image/jpeg', bytes: photos[2]! }, SYSTEM_ACTOR);
    expect(await h.ctx.db.selectFrom('model_images').select('sha256').where('model_id', '=', catalog.modelId).execute()).toEqual([{ sha256: c!.sha256 }]);
    expect((await operator.request('DELETE', `${posts(post.id)}/photos/${c!.sha256}`)).statusCode).toBe(200);
    expect(await h.ctx.db.selectFrom('media_objects').select('sha256').where('sha256', '=', c!.sha256).execute()).toHaveLength(1);
    expect((await audits('circle.post.photo.remove', post.id)).map((e) => e.details)).toEqual([
      { sha256: d!.sha256, position: 4 },
      { sha256: c!.sha256, position: 3 },
    ]);

    const shown = await read(m.client, post.id);
    expect(shown.photos).toEqual([
      { url: `/api/v1/media/${b!.sha256}`, alt: 'The atelier at dawn' },
      { url: `/api/v1/media/${a!.sha256}`, alt: null },
    ]);
    expect((await feed(m.client)).items.find((p) => p.id === post.id)?.cover).toEqual({ url: `/api/v1/media/${b!.sha256}`, alt: 'The atelier at dawn' });
  });

  it('takes YES or NO to an invitation within its capacity, under the post\'s lock, until the event; audited, the account as actor', async () => {
    const invitation = await create({ kind: 'INVITATION', title: 'Dinner at the atelier', eventAt: at(24 * HOUR), eventPlace: 'Paris', capacity: 2 });
    await publish(invitation.id);
    const [first, second, third] = [await member(1), await member(1), await member(1)];
    const rsvp = (c: Client, answer: string) => c.post(`/api/v1/club/circle/${invitation.id}/rsvp`, { answer });

    expect(errorOf(await first.client.post(`/api/v1/club/circle/${invitation.id}/rsvp`, { answer: 'YES' }, { noCsrf: true })).code).toBe('CSRF_FAILED');
    expect(errorOf(await rsvp(first.client, 'MAYBE')).code).toBe('VALIDATION_FAILED');
    const before = await read(first.client, invitation.id);
    expect(before).toMatchObject({ answer: null, invitation: { eventAt: invitation.eventAt, place: 'Paris', capacity: 2, placesLeft: 2, open: true }, poll: null });

    const yes = await rsvp(first.client, 'YES');
    expect(yes.statusCode, yes.body).toBe(200);
    expect(yes.headers['cache-control']).toBe('no-store');
    expect(safeJson(yes)).toMatchObject({ answer: 'YES', invitation: { placesLeft: 1 } });
    // The same answer again writes nothing.
    expect((await rsvp(first.client, 'YES')).statusCode).toBe(200);
    // Two accounts at once for the last place: one is answered, the other told it is full.
    const both = await Promise.all([rsvp(second.client, 'YES'), rsvp(third.client, 'YES')]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(errorOf(both.find((r) => r.statusCode === 409)!).code).toBe('CIRCLE_FULL');
    const yesCount = async () =>
      Number((await h.ctx.db.selectFrom('circle_rsvps').select((eb) => eb.fn.countAll<number>().as('n')).where('post_id', '=', invitation.id).where('answer', '=', 'YES').executeTakeFirstOrThrow()).n);
    expect(await yesCount()).toBe(2);
    // A NO frees a place, which the other may then take.
    expect(safeJson(await rsvp(first.client, 'NO'))).toMatchObject({ answer: 'NO', invitation: { placesLeft: 1 } });
    const late = both[0]!.statusCode === 409 ? second : third;
    expect((await rsvp(late.client, 'YES')).statusCode).toBe(200);
    expect(await yesCount()).toBe(2);
    expect(errorOf(await rsvp(first.client, 'YES')).code).toBe('CIRCLE_FULL');
    expect((await feed(first.client)).items.find((p) => p.id === invitation.id)).toMatchObject({ answer: 'NO', eventAt: invitation.eventAt, eventPlace: 'Paris' });

    // Audited for each change, the account as actor; never its email.
    const audited = await audits('circle.rsvp', invitation.id);
    expect(audited.filter((e) => e.actor_id === first.id).map((e) => [e.actor_type, e.details])).toEqual([
      ['account', { answer: 'YES' }],
      ['account', { answer: 'NO', previous: 'YES' }],
    ]);
    expect(JSON.stringify(audited)).not.toContain(first.email);

    // The console: the answers, the emails masked for an AUDITOR; by answer.
    const listed = safeJson(await operator.get(`${posts(invitation.id)}/answers`)) as { items: { accountId: string; email: string; answer: string }[]; total: number };
    expect(listed.total).toBe(3);
    expect(listed.items.find((a) => a.accountId === first.id)).toMatchObject({ email: first.email, answer: 'NO' });
    const masked = safeJson(await auditor.get(`${posts(invitation.id)}/answers?answer=NO`)) as { items: { email: string }[] };
    expect(masked.items.map((a) => a.email)).toEqual([`${first.email[0]}***${first.email.slice(first.email.indexOf('@'))}`]);
    expect((safeJson(await auditor.get(posts(invitation.id))) as AdminPostJson).answers).toEqual({ YES: 2, NO: 1 });

    // Not an invitation: no answer; the event begun: answers closed.
    const note = await create({ title: 'A note' });
    await publish(note.id);
    expect(errorOf(await first.client.post(`/api/v1/club/circle/${note.id}/rsvp`, { answer: 'YES' })).code).toBe('CIRCLE_NOT_INVITATION');
    h.clock.advance(24 * HOUR);
    await staff();
    expect(errorOf(await rsvp(first.client, 'YES')).code).toBe('CIRCLE_EVENT_PAST');
    expect((await read(first.client, invitation.id)).invitation?.open).toBe(false);
  });

  it('takes one vote per account in a poll, final, its results shown once voted; never audited', async () => {
    const poll = await create({ kind: 'POLL', title: 'Which metal next?', pollOptions: ['Gold', 'Platinum', 'Titanium'] });
    await publish(poll.id);
    const [a, b] = [await member(1), await member(1)];
    const vote = (c: Client, option: unknown) => c.post(`/api/v1/club/circle/${poll.id}/vote`, { option });

    expect(await read(a.client, poll.id)).toMatchObject({ voted: false, poll: { options: ['Gold', 'Platinum', 'Titanium'], vote: null, results: null } });
    for (const option of [-1, 6, 1.5, 'Gold']) expect(errorOf(await vote(a.client, option)).code, String(option)).toBe('VALIDATION_FAILED');
    expect(errorOf(await vote(a.client, 3)).code).toBe('VALIDATION_FAILED');
    const voted = await vote(a.client, 1);
    expect(voted.statusCode, voted.body).toBe(200);
    expect(safeJson(voted)).toMatchObject({ voted: true, poll: { vote: 1, results: { counts: [0, 1, 0], total: 1 } } });
    const again = await vote(a.client, 2);
    expect([again.statusCode, errorOf(again).code]).toEqual([409, 'CIRCLE_ALREADY_VOTED']);
    // The other account sees no result before its own vote.
    expect((await read(b.client, poll.id)).poll?.results).toBeNull();
    expect(safeJson(await vote(b.client, 1))).toMatchObject({ poll: { vote: 1, results: { counts: [0, 2, 0], total: 2 } } });
    expect((await feed(a.client)).items.find((p) => p.id === poll.id)?.voted).toBe(true);
    expect((safeJson(await auditor.get(posts(poll.id))) as AdminPostJson).results).toEqual({ counts: [0, 2, 0], total: 2 });
    // No audit entry names a vote, nor the account's choice.
    const entries = await h.ctx.db.selectFrom('audit_logs').selectAll().where('target_id', '=', poll.id).execute();
    expect(entries.map((e) => e.action).sort()).toEqual(['circle.post.create', 'circle.post.publish']);
    // Not a poll: no vote.
    const note = await create({ title: 'Another note' });
    await publish(note.id);
    expect(errorOf(await a.client.post(`/api/v1/club/circle/${note.id}/vote`, { option: 0 })).code).toBe('CIRCLE_NOT_POLL');
  });

  it('counts a visit per day on the feed\'s first page, with no account; the Analytics panel reads the members by tier and the visits by day', async () => {
    const m = await member(1);
    await h.ctx.db.deleteFrom('circle_daily_visits').execute();
    const today = h.clock.now().toISOString().slice(0, 10);
    await feed(m.client);
    await feed(m.client);
    await feed(m.client, '?page=2');
    // A post read, or one that is not there, is no visit either.
    const post = await create({ title: 'Read, not a visit' });
    expect((await m.client.get(`/api/v1/club/circle/${post.id}`)).statusCode).toBe(404);
    await publish(post.id);
    await read(m.client, post.id);
    expect(await visits()).toEqual([[today, 2]]);
    // A refused reader is no visit.
    await (await accountClient(h)).client.get('/api/v1/club/circle');
    expect(await visits()).toEqual([[today, 2]]);

    // The panel: the window of Analytics (complete days), the members of each tier now (ACTIVE accounts only).
    const res = await auditor.get('/api/admin/analytics/circle?days=30');
    expect(res.statusCode, res.body).toBe(200);
    const stats = safeJson(res) as { from: string; to: string; days: number; members: Record<string, number>; visits: { total: number; daily: { day: string; visits: number }[] } };
    expect(stats.days).toBe(30);
    expect(stats.visits.daily).toHaveLength(30);
    expect(stats.visits.daily.at(-1)!.day).toBe(stats.to);
    expect(stats.visits.total).toBe(0);
    const owners = await h.ctx.db
      .selectFrom('ownership as o')
      .innerJoin('products as p', 'p.id', 'o.product_id')
      .innerJoin('accounts as a', 'a.id', 'o.account_id')
      .select(['o.account_id', (eb) => eb.fn.countAll<number>().as('n')])
      .where('o.ended_at', 'is', null)
      .where('p.status', 'not in', ['REVOKED', 'COUNTERFEIT_FLAGGED', 'RETIRED'])
      .where('a.status', '=', 'ACTIVE')
      .groupBy('o.account_id')
      .execute();
    const tierOf = (n: number) => (n >= 5 ? 'PALLADIUM' : n >= 3 ? 'PLATINE' : 'TITANE');
    const expected = { TITANE: 0, PLATINE: 0, PALLADIUM: 0, total: owners.length };
    for (const o of owners) expected[tierOf(Number(o.n))]++;
    expect(stats.members).toEqual(expected);
    expect(expected.TITANE).toBeGreaterThan(0);
    // A locked account counts for nothing.
    expect((await admin.post(`/api/admin/owners/${m.id}/lock`)).statusCode).toBe(200);
    const after = safeJson(await auditor.get('/api/admin/analytics/circle')) as typeof stats;
    expect(after.members.total).toBe(expected.total - 1);
    // Tomorrow (past the settling of the day), the visits of today are in the window, by day; nothing names an account.
    h.clock.advance(25 * HOUR);
    await staff();
    const next = safeJson(await auditor.get('/api/admin/analytics/circle?days=30')) as typeof stats;
    expect(next.visits.daily.find((d) => d.day === today)).toEqual({ day: today, visits: 2 });
    expect(next.visits.total).toBe(2);
    expect(Object.keys(next.visits.daily[0]!).sort()).toEqual(['day', 'visits']);
    expect(errorOf(await auditor.get('/api/admin/analytics/circle?days=367')).code).toBe('VALIDATION_FAILED');
  });

  it('lists an account\'s answers and votes in its right-of-access export', async () => {
    const m = await member(1);
    const invitation = await create({ kind: 'INVITATION', title: 'A fitting', eventAt: at(10 * HOUR) });
    const poll = await create({ kind: 'POLL', title: 'Which finish?', pollOptions: ['Polished', 'Brushed'] });
    await publish(invitation.id);
    await publish(poll.id);
    expect((await m.client.post(`/api/v1/club/circle/${invitation.id}/rsvp`, { answer: 'YES' })).statusCode).toBe(200);
    expect((await m.client.post(`/api/v1/club/circle/${poll.id}/vote`, { option: 1 })).statusCode).toBe(200);
    const res = await admin.get(`/api/admin/owners/${m.id}/export`);
    expect(res.statusCode, res.body).toBe(200);
    const x = safeJson(res) as { circleAnswers: Record<string, unknown>[]; circleVotes: Record<string, unknown>[]; activity: { action: string }[] };
    expect(x.circleAnswers).toEqual([{ postId: invitation.id, title: 'A fitting', answer: 'YES', firstAnsweredAt: h.clock.now().toISOString(), answeredAt: h.clock.now().toISOString() }]);
    expect(x.circleVotes).toEqual([{ postId: poll.id, title: 'Which finish?', option: 1, optionText: 'Brushed', votedAt: h.clock.now().toISOString() }]);
    // The answer is in the activity (audited); the vote is not.
    expect(x.activity.map((e) => e.action)).toContain('circle.rsvp');
    expect((await audits('account.export', m.id))[0]!.details).toMatchObject({ circleAnswers: 1, circleVotes: 1 });
  });
});
