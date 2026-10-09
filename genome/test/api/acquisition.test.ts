/**
 * Where they come from, through the real routes (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.15 « api/acquisition
 * .test.ts »):
 *
 *  - the arrival (step 4.2): `POST /api/v1/seen` with `a` answers 204, alone (`e: []`) or with views; the device cookie
 *    set on a first request; the visit and the device's first source written; another origin refused (403); every
 *    junk field of `a` dropped rather than refused, an unknown key refused (400); a console session records nothing.
 *  - the redirects (step 4.3): `/go/<code>` for each destination (a model's current slug after a rename), an unknown
 *    code, capitals, a trailing slash, HEAD; `no-store`, `noindex` and `Referrer-Policy: strict-origin-when-cross-origin`
 *    on the 302 while a normal page keeps `no-referrer`; nothing written; the `api` rate limit; `GET /?utm_…` → 302
 *    `/verify?utm_…` with the same header, `GET /` → `/verify` as before, a query over 2 000 characters dropped.
 *  - the console's link routes (step 4.3): 201 and the link, the channel; the errors in their words; 204 for a channel
 *    removed; the audit entries (the roles: admin-roles.test.ts).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymize } from '../../src/server/http/client.js';
import { adminClient, createAdmin, createHarness, errorOf, safeJson, seedCatalog, type Client, type Harness } from './support.js';

const DEVICE = { s: false, t: 5, w: 390 };

describe('POST /api/v1/seen with the arrival (§3.4 A.7.2, step 4.2)', () => {
  let h: Harness;
  let linkSource: number;

  beforeAll(async () => {
    h = await createHarness({ config: { rateLimits: { apiPerMinute: 1_000 } } });
    h.clock.set('2026-10-12T08:00:00.000Z');
    const admin = (await createAdmin(h.ctx, 'OPERATOR')).id;
    const channel = (await h.ctx.db.selectFrom('link_channels').select('id').where('name', '=', 'Influencers').executeTakeFirstOrThrow()).id;
    const link = await h.ctx.db.insertInto('links').values({ code: 'lea-tiktok', name: 'Léa — TikTok', channel_id: channel, destination: 'NOW', created_by: admin }).returning('id').executeTakeFirstOrThrow();
    linkSource = (await h.ctx.db.insertInto('acquisition_sources').values({ kind: 'LINK', link_id: link.id, key: `L:${link.id}` }).returning('id').executeTakeFirstOrThrow()).id;
  });
  afterAll(() => h?.close());

  const seen = (c: Client, body: unknown, opts: { origin?: string | null } = {}) => c.request('POST', '/api/v1/seen', { body, ...opts });
  const deviceOf = async (c: Client) => {
    const id = h.app.unsignCookie(c.cookies.get('orbes_device')!).value!;
    return h.ctx.db.selectFrom('tracking_devices').selectAll().where('device_hash', '=', pseudonymize(h.ctx.config.ipHashPepper, 'device', id)).executeTakeFirstOrThrow();
  };
  const touchesOf = (deviceId: number) => h.ctx.db.selectFrom('acquisition_touches').selectAll().where('device_id', '=', deviceId).execute();

  it('answers 204 to an arrival alone, sets the device cookie on a first request, and records the visit and the first source', async () => {
    const c = h.client({ ip: '198.51.100.60' });
    const res = await seen(c, { v: 1, d: DEVICE, a: { path: '/verify/releases', link: 'LEA-TIKTOK' }, e: [] });
    expect(res.statusCode).toBe(204);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.cookies.find((x) => x.name === 'orbes_device')).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
    const device = await deviceOf(c);
    expect(device.first_source_id).toBe(linkSource);
    expect((await touchesOf(device.id)).map((r) => ({ source: r.source_id, day: r.day, arrivals: r.arrivals, account: r.account_id }))).toEqual([{ source: linkSource, day: '2026-10-12', arrivals: 1, account: null }]);
    // A second page load the same day: the same visit, one more arrival.
    expect((await seen(c, { v: 1, d: DEVICE, a: { link: 'lea-tiktok' }, e: [{ p: 'NOW', ms: 3_000, ago: 0 }] })).statusCode).toBe(204);
    expect((await touchesOf(device.id))[0]!.arrivals).toBe(2);
  });

  it('drops each junk field of the arrival rather than refusing the beacon, and refuses an unknown key', async () => {
    const c = h.client({ ip: '198.51.100.61' });
    const junk = {
      path: '/admin/secret?x=1',
      link: '<script>',
      utm: { source: `${'s'.repeat(101)}`, medium: '\u0000', campaign: 42, content: '   ', term: ['x'] },
      referrer: 'javascript:alert(1)',
    };
    expect((await seen(c, { v: 1, d: DEVICE, a: junk, e: [] })).statusCode).toBe(204);
    // Nothing usable: a Direct arrival, the device's first source Direct, no visit.
    const device = await deviceOf(c);
    const direct = (await h.ctx.db.selectFrom('acquisition_sources').select('id').where('key', '=', 'DIRECT').executeTakeFirstOrThrow()).id;
    expect(device.first_source_id).toBe(direct);
    expect(await touchesOf(device.id)).toEqual([]);
    // One junk tag among good ones: the good ones kept, in lower case.
    const d = h.client({ ip: '198.51.100.62' });
    expect((await seen(d, { v: 1, d: DEVICE, a: { utm: { source: 'IG', campaign: 'Drop-14', medium: 'x'.repeat(101) }, referrer: `https://example.com/${'p'.repeat(600)}` }, e: [] })).statusCode).toBe(204);
    const source = await h.ctx.db.selectFrom('acquisition_sources').selectAll().where('id', '=', (await deviceOf(d)).first_source_id!).executeTakeFirstOrThrow();
    expect(source).toMatchObject({ kind: 'CAMPAIGN', utm_source: 'ig', utm_medium: null, utm_campaign: 'drop-14' });
    for (const body of [
      { v: 1, d: DEVICE, a: { path: '/verify', x: 1 }, e: [] },
      { v: 1, d: DEVICE, a: 'instagram', e: [] },
      { v: 1, d: DEVICE, e: [] },
    ]) {
      const res = await seen(c, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    }
  });

  it('refuses another origin with 403 and records nothing', async () => {
    const c = h.client({ ip: '198.51.100.63' });
    const res = await seen(c, { v: 1, d: DEVICE, a: { link: 'lea-tiktok' }, e: [] }, { origin: 'https://evil.example' });
    expect(res.statusCode).toBe(403);
    expect(c.cookies.has('orbes_device')).toBe(false);
  });

  it('records nothing for a browser signed into the console, and marks it', async () => {
    const staff = await adminClient(h, 'OPERATOR', { ip: '198.51.100.64' });
    expect((await seen(staff, { v: 1, d: DEVICE, a: { link: 'lea-tiktok' }, e: [] })).statusCode).toBe(204);
    const device = await deviceOf(staff);
    expect(device.staff_at).toEqual(expect.any(Date));
    expect(device.first_source_id).toBeNull();
    expect(await touchesOf(device.id)).toEqual([]);
  });
});

describe('GET /go/<code> and GET / (§3.4 A.3, A.7.2, step 4.3)', () => {
  let h: Harness;
  let dir: string;
  let dropId: string;
  let modelId: string;
  let slug: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'orbes-go-'));
    for (const app of ['verify', 'admin', 'legal']) {
      mkdirSync(join(dir, app));
      writeFileSync(join(dir, app, 'index.html'), `<!doctype html><title>${app.toUpperCase()}</title>`);
    }
    mkdirSync(join(dir, 'assets'));
    h = await createHarness({ app: { serveStatic: true, staticDir: dir }, config: { rateLimits: { apiPerMinute: 1_000 } } });
    h.clock.set('2026-10-12T08:00:00.000Z');
    const actor = { type: 'admin' as const, id: (await createAdmin(h.ctx, 'OPERATOR')).id };
    const catalog = await seedCatalog(h.ctx);
    modelId = catalog.modelId;
    slug = `go-${randomUUID().slice(0, 6)}`;
    await h.ctx.db.updateTable('models').set({ slug, lookbook: 'PUBLIC', published_at: new Date('2026-01-01T00:00:00Z') }).where('id', '=', modelId).execute();
    dropId = (
      await h.ctx.db
        .insertInto('drops')
        .values({ model_id: modelId, title: 'GO', quantity: 8, opens_at: new Date('2026-10-14T18:00:00Z'), closes_at: new Date('2026-10-15T18:00:00Z'), seed_enc: `v1.${'A'.repeat(16)}.${'B'.repeat(64)}`, seed_hash: new Uint8Array(32).fill(3), published_at: new Date('2026-10-01T00:00:00Z') })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const channelId = (await h.ctx.services.links.channels())[0]!.id;
    const make = (code: string, destination: string, extra: Record<string, unknown> = {}) => h.ctx.services.links.create({ name: code, code, channelId, destination, ...extra }, actor);
    await make('instagram-bio', 'NOW');
    await make('the-release', 'RELEASE', { dropId });
    await make('the-sheet', 'MODEL', { modelId });
    await make('the-releases', 'RELEASES');
    await make('the-collection', 'COLLECTION');
    await make('the-club', 'CLUB');
    await make('how-it-works', 'HOW');
  });
  afterAll(async () => {
    await h?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const go = (url: string, method: 'GET' | 'HEAD' = 'GET') => h.app.inject({ method, url, remoteAddress: '198.51.100.70', headers: { referer: 'https://www.instagram.com/' } });

  it('answers 302 to each destination with ?o=<code>, no-store, noindex and the redirect\'s Referrer-Policy, and writes nothing', async () => {
    const before = await h.ctx.db.selectFrom('acquisition_touches').select('id').execute();
    for (const [code, location] of [
      ['instagram-bio', '/verify?o=instagram-bio'],
      ['the-release', `/verify/releases/${dropId}?o=the-release`],
      ['the-sheet', `/verify/lookbook/${slug}?o=the-sheet`],
      ['the-releases', '/verify/releases?o=the-releases'],
      ['the-collection', '/verify/lookbook?o=the-collection'],
      ['the-club', '/verify/club?o=the-club'],
      ['how-it-works', '/verify/releases/how?o=how-it-works'],
    ] as const) {
      const res = await go(`/go/${code}`);
      expect(res.statusCode, code).toBe(302);
      expect(res.headers.location, code).toBe(location);
      expect(res.headers['cache-control'], code).toBe('no-store');
      expect(res.headers['x-robots-tag'], code).toBe('noindex, nofollow');
      expect(res.headers['referrer-policy'], code).toBe('strict-origin-when-cross-origin');
      expect(res.cookies, code).toEqual([]);
    }
    expect(await h.ctx.db.selectFrom('acquisition_touches').select('id').execute()).toEqual(before);
    expect(await h.ctx.db.selectFrom('tracking_devices').select('id').execute()).toEqual([]);
  });

  it('reads a model\'s current slug, a code in capitals or with a trailing slash, and HEAD; an unknown code goes to /verify', async () => {
    const renamed = `${slug}-ii`;
    await h.ctx.db.updateTable('models').set({ slug: renamed }).where('id', '=', modelId).execute();
    expect((await go('/go/the-sheet')).headers.location).toBe(`/verify/lookbook/${renamed}?o=the-sheet`);
    expect((await go('/go/Instagram-Bio')).headers.location).toBe('/verify?o=instagram-bio');
    expect((await go('/go/instagram-bio/')).headers.location).toBe('/verify?o=instagram-bio');
    const head = await go('/go/instagram-bio', 'HEAD');
    expect(head.statusCode).toBe(302);
    expect(head.headers.location).toBe('/verify?o=instagram-bio');
    for (const url of ['/go/no-such-link', '/go/%3Cscript%3E', `/go/${'x'.repeat(120)}`]) {
      const res = await go(url);
      expect(res.statusCode, url).toBe(302);
      expect(res.headers.location, url).toBe('/verify');
      expect(res.headers['referrer-policy'], url).toBe('strict-origin-when-cross-origin');
    }
  });

  it('keeps GET /\'s query string with the same Referrer-Policy; GET / alone as before; every other page keeps no-referrer', async () => {
    const tagged = await go('/?utm_source=ig&utm_campaign=drop');
    expect(tagged.statusCode).toBe(302);
    expect(tagged.headers.location).toBe('/verify?utm_source=ig&utm_campaign=drop');
    expect(tagged.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    const plain = await go('/');
    expect(plain.headers.location).toBe('/verify');
    expect(plain.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect((await go('/?')).headers.location).toBe('/verify');
    expect((await go(`/?utm_source=${'x'.repeat(2_000)}`)).headers.location).toBe('/verify');
    for (const url of ['/verify', '/verify/releases?o=instagram-bio', '/admin', '/legal/privacy', '/api/v1/health']) {
      expect((await go(url)).headers['referrer-policy'], url).toBe('no-referrer');
    }
  });

  it('draws on the api budget', async () => {
    const small = await createHarness({ config: { rateLimits: { apiPerMinute: 2 } } });
    try {
      const at = (n: number) => small.app.inject({ method: 'GET', url: `/go/x-${n}`, remoteAddress: '198.51.100.71' });
      expect((await at(1)).statusCode).toBe(302);
      expect((await at(2)).statusCode).toBe(302);
      const refused = await at(3);
      expect(refused.statusCode).toBe(429);
      expect(errorOf(refused).code).toBe('RATE_LIMITED');
    } finally {
      await small.close();
    }
  });
});

describe('the console\'s link routes (§3.4 A.7.2, step 4.3)', () => {
  let h: Harness;
  let operator: Client;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-12T08:00:00.000Z');
    operator = await adminClient(h, 'OPERATOR');
  });
  afterAll(() => h?.close());

  it('makes, edits, archives and unarchives a link, with the errors in their words', async () => {
    const channels = safeJson(await operator.get('/api/admin/link-channels')) as { channels: { id: string; name: string; links: number }[] };
    expect(channels.channels.map((c) => c.name)).toEqual(['Instagram', 'TikTok', 'Influencers', 'Press', 'Shops', 'Search', 'Other']);
    const instagram = channels.channels[0]!.id;
    const made = await operator.post('/api/admin/links', { name: 'Instagram bio', channelId: instagram, destination: 'NOW', cost: { minor: 20_000, currency: 'EUR' } });
    expect(made.statusCode).toBe(201);
    const { link } = safeJson(made) as { link: { id: string; code: string; address: string; directAddress: string; cost: unknown } };
    expect(link).toMatchObject({ code: 'instagram-bio', address: 'https://verify.orbes.test/go/instagram-bio', directAddress: 'https://verify.orbes.test/verify?o=instagram-bio', cost: { minor: 20_000, currency: 'EUR' } });
    const again = await operator.post('/api/admin/links', { name: 'Again', channelId: instagram, destination: 'NOW', code: 'instagram-bio' });
    expect(again.statusCode).toBe(409);
    expect(errorOf(again)).toEqual({ code: 'LINK_CODE_TAKEN', message: 'Another link already uses this address.' });
    for (const [body, message] of [
      [{ name: '', channelId: instagram, destination: 'NOW' }, 'Give the link a name.'],
      [{ name: 'X', channelId: instagram, destination: 'NOW', code: 'X Y' }, 'The address is 3 to 32 letters, figures or dashes, in lower case.'],
      [{ name: 'X', channelId: instagram, destination: 'RELEASE' }, 'Choose where the link goes.'],
      [{ name: 'X', channelId: instagram, destination: 'NOW', cost: { minor: 1.5, currency: 'EUR' } }, 'The cost is an amount with cents, in one currency.'],
    ] as const) {
      const res = await operator.post('/api/admin/links', body);
      expect(res.statusCode, message).toBe(400);
      expect(errorOf(res).message).toBe(message);
    }
    const edited = await operator.patch(`/api/admin/links/${link.id}`, { name: 'Bio', note: 'Pinned.' });
    expect(edited.statusCode).toBe(200);
    expect((safeJson(edited) as { link: { name: string; note: string } }).link).toMatchObject({ name: 'Bio', note: 'Pinned.' });
    const fixed = await operator.patch(`/api/admin/links/${link.id}`, { code: 'bio' });
    expect(fixed.statusCode).toBe(400);
    expect(errorOf(fixed).message).toBe('A link’s address never changes. Make a new link.');
    const archived = await operator.post(`/api/admin/links/${link.id}/archive`);
    expect((safeJson(archived) as { link: { archivedAt: string | null } }).link.archivedAt).toEqual(expect.any(String));
    const back = await operator.post(`/api/admin/links/${link.id}/unarchive`);
    expect((safeJson(back) as { link: { archivedAt: string | null } }).link.archivedAt).toBeNull();
    expect((await operator.post(`/api/admin/links/${randomUUID()}/archive`)).statusCode).toBe(404);
    const actions = (await h.ctx.db.selectFrom('audit_logs').select('action').where('target_id', '=', link.id).orderBy('id').execute()).map((a) => a.action);
    expect(actions).toEqual(['link.create', 'link.update', 'link.archive', 'link.unarchive']);
    // The destinations the dialog offers.
    const destinations = safeJson(await operator.get('/api/admin/links/destinations')) as { releases: unknown[]; models: unknown[] };
    expect(destinations).toEqual({ releases: expect.any(Array), models: expect.any(Array) });
  });

  it('adds, renames and removes a channel: 201, 200, 204; 409 while a link uses it', async () => {
    const made = await operator.post('/api/admin/link-channels', { name: 'Newsletters' });
    expect(made.statusCode).toBe(201);
    const { channel } = safeJson(made) as { channel: { id: string; name: string; position: number; links: number } };
    expect(channel).toMatchObject({ name: 'Newsletters', links: 0 });
    const renamed = await operator.patch(`/api/admin/link-channels/${channel.id}`, { name: 'Letters', position: 75 });
    expect((safeJson(renamed) as { channel: unknown }).channel).toMatchObject({ name: 'Letters', position: 75 });
    const taken = await operator.post('/api/admin/link-channels', { name: 'letters' });
    expect(taken.statusCode).toBe(409);
    expect(errorOf(taken)).toEqual({ code: 'CHANNEL_NAME_TAKEN', message: 'Another channel has this name.' });
    await operator.post('/api/admin/links', { name: 'In letters', channelId: channel.id, destination: 'NOW' });
    const used = await operator.request('DELETE', `/api/admin/link-channels/${channel.id}`);
    expect(used.statusCode).toBe(409);
    expect(errorOf(used).code).toBe('CHANNEL_IN_USE');
    const empty = safeJson(await operator.post('/api/admin/link-channels', { name: 'Empty' })) as { channel: { id: string } };
    const removed = await operator.request('DELETE', `/api/admin/link-channels/${empty.channel.id}`);
    expect(removed.statusCode).toBe(204);
    expect(removed.body).toBe('');
  });
});
