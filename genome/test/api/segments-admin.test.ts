/**
 * The segments and the access rules beyond the tier (plan LIVE RELEASE+, choices 3, 4, 27 and decision 32), over HTTP
 * with real sessions:
 *
 *  - the console's Segments routes: the builder's options, the live count (OPERATOR), a segment created (201), changed,
 *    read with its members now and what uses it (and by its id and name alone, the choices of a release and a post),
 *    refused when malformed (400) or named twice (409), deleted only when
 *    nothing uses it (409 SEGMENT_IN_USE, then 204); its members' CSV, an attachment no cache keeps, the emails in clear
 *    for an OPERATOR and masked for an AUDITOR;
 *  - a LIVE RELEASE's settings: the releases taken part in, the segment, AND or OR, the surprise; then its public page
 *    (the rules in words, A SURPRISE IN EVERY BOX as a flag, never the description nor the segment's name) and the
 *    403 of an account outside them, with its count of releases taken part in or « This release is for selected
 *    collectors. »;
 *  - a post of the circle for a segment.
 * Which role reaches which route is test/api/admin-roles.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { holdPieces, liveFixtureOn, type LiveFixture } from '../support/live.js';
import { accountClient, adminClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

type Json = Record<string, any>;
const MINUTE = 60_000;
const HOUR = 3_600_000;

describe('segments and the access rules: the console’s and the public routes', () => {
  let h: Harness;
  let f: LiveFixture;
  let op: Client;
  let auditor: Client;
  let member: { client: Client; id: string; email: string };
  let outsider: { client: Client; id: string; email: string };

  const signedIn = async () => {
    const { client, email } = await accountClient(h);
    const { id } = await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email.toLowerCase()).executeTakeFirstOrThrow();
    return { client, id, email };
  };

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-10T09:00:00.000Z');
    f = await liveFixtureOn(h.ctx, h.clock);
    op = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
    member = await signedIn();
    outsider = await signedIn();
    await holdPieces(h.ctx.db, member.id, 1, f.modelId, { variant: '58' });
    await holdPieces(h.ctx.db, outsider.id, 5, f.modelId, { variant: '50' });
  });
  afterAll(() => h?.close());

  const SIZE_58 = { match: 'ALL', rules: [{ kind: 'SIZE', sizes: ['58'] }] };

  it('builds a segment: options, the live count, created, changed, read; refuses a malformed tree and a name taken', async () => {
    const options = safeJson(await auditor.get('/api/admin/segments/options')) as Json;
    expect(options.sizes).toEqual(expect.arrayContaining(['50', '58']));
    expect(options.models).toEqual(expect.arrayContaining([expect.objectContaining({ id: f.modelId, name: 'MONOLITHE' })]));

    const counted = await op.post('/api/admin/segments/count', { criteria: SIZE_58 });
    expect([counted.statusCode, safeJson(counted)]).toEqual([200, { count: 1 }]);
    expect((await auditor.post('/api/admin/segments/count', { criteria: SIZE_58 })).statusCode).toBe(403);
    const bad = await op.post('/api/admin/segments/count', { criteria: { match: 'ALL', rules: [{ kind: 'SIZE', sizes: [] }] } });
    expect([bad.statusCode, errorOf(bad).code]).toEqual([400, 'VALIDATION_FAILED']);
    expect((await op.post('/api/admin/segments/count', { criteria: { match: 'ALL', rules: [{ kind: 'LUCK' }] } })).statusCode).toBe(400);

    const created = await op.post('/api/admin/segments', { name: 'Size 58', criteria: SIZE_58 });
    expect(created.statusCode).toBe(201);
    const s = safeJson(created) as Json;
    expect(s).toMatchObject({ name: 'Size 58', criteria: SIZE_58, count: 1, usedBy: { releases: [], posts: [] } });
    const taken = await op.post('/api/admin/segments', { name: 'size 58', criteria: SIZE_58 });
    expect([taken.statusCode, errorOf(taken).code]).toEqual([409, 'SEGMENT_NAME_TAKEN']);

    const changed = await op.patch(`/api/admin/segments/${s.id}`, { criteria: { match: 'ANY', rules: [{ kind: 'SIZE', sizes: ['58'] }, { kind: 'TIER', tiers: [2] }] } });
    expect(changed.statusCode).toBe(200);
    expect((safeJson(changed) as Json).count).toBe(2);
    expect((await op.patch(`/api/admin/segments/${s.id}`, {})).statusCode).toBe(400);
    await op.patch(`/api/admin/segments/${s.id}`, { criteria: SIZE_58 });
    const list = safeJson(await auditor.get('/api/admin/segments')) as Json;
    expect(list.items.map((x: Json) => [x.name, x.count])).toEqual([['Size 58', 1]]);
    // The choices of a release's access rule and a post's audience: the id and the name, no count read.
    expect(safeJson(await auditor.get('/api/admin/segments/names'))).toEqual({ items: [{ id: s.id, name: 'Size 58' }] });
    const missing = await auditor.get('/api/admin/segments/00000000-0000-4000-8000-000000000000');
    expect([missing.statusCode, errorOf(missing).code]).toEqual([404, 'SEGMENT_NOT_FOUND']);
  });

  it('gives its members as a CSV: in clear for an OPERATOR, masked for an AUDITOR, never kept by a cache', async () => {
    const s = (safeJson(await auditor.get('/api/admin/segments')) as Json).items[0];
    const clear = await op.get(`/api/admin/segments/${s.id}/members.csv`);
    expect(clear.statusCode).toBe(200);
    expect(clear.headers['content-type']).toMatch(/^text\/csv/);
    expect(clear.headers['cache-control']).toBe('no-store');
    expect(clear.headers['content-disposition']).toBe('attachment; filename="orbes-segment-size-58.csv"');
    expect(clear.body).toContain(`"${member.email}"`);
    expect(clear.body).not.toContain(outsider.email);
    const masked = await auditor.get(`/api/admin/segments/${s.id}/members.csv`);
    expect(masked.body).not.toContain(member.email);
    expect(masked.body).toContain(`"${member.email[0]}***@${member.email.split('@')[1]}"`);
  });

  it('a release for the segment and for those who took part: the page says it in words, the 403 says what lacks', async () => {
    const s = (safeJson(await auditor.get('/api/admin/segments')) as Json).items[0];
    const opensAt = new Date(h.clock.now().getTime() + 2 * HOUR);
    const created = await op.post('/api/admin/live', {
      modelId: f.modelId,
      title: 'MONOLITHE — LIVE',
      opensAt: opensAt.toISOString(),
      closesAt: new Date(opensAt.getTime() + HOUR).toISOString(),
      priceMinor: 480_000,
      sizes: [{ label: '52', stock: 3 }],
      accessSegmentId: s.id,
      surpriseEnabled: true,
      surpriseText: 'A silk pouch, hand-stitched.',
    });
    expect(created.statusCode).toBe(201);
    const r = safeJson(created) as Json;
    expect(r.access).toMatchObject({ segment: { id: s.id, name: 'Size 58' }, combine: 'AND', text: 'selected collectors' });
    expect(r.surprise).toEqual({ enabled: true, text: 'A silk pouch, hand-stitched.' });
    expect((await op.post(`/api/admin/live/${r.id}/publish`, {})).statusCode).toBe(200);

    const page = await h.client().get(`/api/v1/live/${r.id}`);
    expect(safeJson(page)).toMatchObject({ access: { minTier: 0, text: 'selected collectors' }, surprise: true });
    expect(page.body).not.toContain('silk');
    expect(page.body).not.toContain('Size 58');
    expect(((safeJson(await h.client().get('/api/v1/live')) as Json).releases as Json[]).find((c) => c.id === r.id)).toMatchObject({ surprise: true });

    const refused = await outsider.client.get(`/api/v1/live/${r.id}/state`);
    expect([refused.statusCode, errorOf(refused)]).toEqual([403, { code: 'LIVE_NOT_ELIGIBLE', message: 'This release is for selected collectors.' }]);
    const state = await member.client.get(`/api/v1/live/${r.id}/state`);
    expect(state.statusCode).toBe(200);
    expect((safeJson(state) as Json).access).toEqual({ allowed: true, tier: 1, missing: null, participations: null });

    // Another release: the segment, or two releases taken part in, any one of them enough (OR); set before its announcement.
    const draft = safeJson(
      await op.post('/api/admin/live', {
        modelId: f.modelId,
        title: 'MONOLITHE — LIVE II',
        opensAt: opensAt.toISOString(),
        closesAt: new Date(opensAt.getTime() + HOUR).toISOString(),
        priceMinor: 480_000,
        sizes: [{ label: '52', stock: 3 }],
      }),
    ) as Json;
    const unknown = await op.patch(`/api/admin/live/${draft.id}`, { accessSegmentId: '00000000-0000-4000-8000-000000000000' });
    expect([unknown.statusCode, errorOf(unknown).code]).toEqual([404, 'SEGMENT_NOT_FOUND']);
    const noText = await op.patch(`/api/admin/live/${draft.id}`, { surpriseEnabled: true });
    expect([noText.statusCode, errorOf(noText).code]).toEqual([400, 'VALIDATION_FAILED']);
    expect((await op.patch(`/api/admin/live/${draft.id}`, { minParticipations: 0 })).statusCode).toBe(400);
    const changed = await op.patch(`/api/admin/live/${draft.id}`, { accessSegmentId: s.id, minParticipations: 2, accessCombine: 'OR' });
    expect([changed.statusCode, (safeJson(changed) as Json).access.text]).toEqual([200, 'collectors who have taken part in 2 releases or selected collectors']);
    expect((await op.post(`/api/admin/live/${draft.id}/publish`, {})).statusCode).toBe(200);
    expect(safeJson(await h.client().get(`/api/v1/live/${draft.id}`))).toMatchObject({ access: { text: 'collectors who have taken part in 2 releases or selected collectors' }, surprise: false });
    const counted = await outsider.client.request('PUT', `/api/v1/live/${draft.id}/interest`, { body: { sizeId: (safeJson(changed) as Json).sizes[0].id } });
    expect([counted.statusCode, errorOf(counted)]).toEqual([
      403,
      { code: 'LIVE_NOT_ELIGIBLE', message: 'This release is for collectors who have taken part in 2 releases or selected collectors. You have taken part in 0 releases.' },
    ]);
    expect((await member.client.request('PUT', `/api/v1/live/${draft.id}/interest`, { body: { sizeId: (safeJson(changed) as Json).sizes[0].id } })).statusCode).toBe(200);
    // Announced: its rules no longer change.
    expect((await op.patch(`/api/admin/live/${draft.id}`, { accessCombine: 'AND' })).statusCode).toBe(409);

    // The segment is in use: never deleted.
    const inUse = await op.request('DELETE', `/api/admin/segments/${s.id}`);
    expect([inUse.statusCode, errorOf(inUse).code]).toEqual([409, 'SEGMENT_IN_USE']);
    expect((safeJson(await auditor.get(`/api/admin/segments/${s.id}`)) as Json).usedBy.releases.map((x: Json) => x.title).sort()).toEqual(['MONOLITHE — LIVE', 'MONOLITHE — LIVE II']);
    h.clock.advance(MINUTE);
  });

  it('a post of the circle for the segment, among its tiers; deleted once nothing uses it', async () => {
    const s = (await h.ctx.services.segments.create({ name: 'Owners of size 50', criteria: { match: 'ALL', rules: [{ kind: 'SIZE', sizes: ['50'] }] } }, f.admin)) as Json;
    const created = await op.post('/api/admin/circle/posts', { kind: 'NOTE', title: 'For size 50', segmentId: s.id });
    expect(created.statusCode).toBe(201);
    const post = safeJson(created) as Json;
    expect(post.segment).toEqual({ id: s.id, name: 'Owners of size 50' });
    await op.post(`/api/admin/circle/posts/${post.id}/publish`, {});
    const titles = async (c: Client) => ((safeJson(await c.get('/api/v1/club/circle')) as Json).items as Json[]).map((x) => x.title);
    expect(await titles(outsider.client)).toContain('For size 50');
    expect(await titles(member.client)).not.toContain('For size 50');
    expect((await member.client.get(`/api/v1/club/circle/${post.id}`)).statusCode).toBe(404);
    expect((await op.patch(`/api/admin/circle/posts/${post.id}`, { segmentId: null })).statusCode).toBe(200);
    expect(await titles(member.client)).toContain('For size 50');
    const removed = await op.request('DELETE', `/api/admin/segments/${s.id}`);
    expect(removed.statusCode).toBe(204);
  });
});
