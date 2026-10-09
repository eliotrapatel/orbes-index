/**
 * Where they come from, through the real routes (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.15 « api/acquisition
 * .test.ts »):
 *
 *  - the arrival (step 4.2): `POST /api/v1/seen` with `a` answers 204, alone (`e: []`) or with views; the device cookie
 *    set on a first request; the visit and the device's first source written; another origin refused (403); every
 *    junk field of `a` dropped rather than refused, an unknown key refused (400); a console session records nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymize } from '../../src/server/http/client.js';
import { adminClient, createAdmin, createHarness, errorOf, type Client, type Harness } from './support.js';

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
