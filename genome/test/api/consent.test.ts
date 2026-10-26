/**
 * The banner's advertising choice (lot M4 plan §3.2, §3.3, §3.6, step M4.11; routes/consent.ts); ACCOUNT's route is
 * test/api/account.test.ts's:
 *
 *  - off (the default): GET /api/v1/consent answers off and sets no cookie; POST /api/v1/consent is refused (409
 *    ADS_OFF) with nothing written and no device cookie;
 *  - the POST's same-origin rule (403) and its strict body (400);
 *  - on: the banner's choice of a device signed out (GRANTED with its click ids, the user agent recorded), read back;
 *    taken by the account at its sign-up with the click ids; the state read by the account first once signed in;
 *  - a choice is never audited (the row is the record).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdsConfig } from '../../src/server/config.js';
import { startHousekeeping } from '../../src/server/context.js';
import { ADS_TEXT_VERSION } from '../../src/server/services/ads.js';
import { parisDay } from '../../src/server/services/schedule.js';
import { startFakeAds, type FakeAds } from '../support/fake-ads.js';
import { createAdmin, createHarness, errorOf, PASSWORD, safeJson, type Harness } from './support.js';

const KEYS: AdsConfig = { meta: { datasetId: '123456789012345', accessToken: 'META-SECRET-TOKEN-0123456789' }, tiktok: null, google: null };
const OFF = { ads: { on: false, choice: null, textVersion: ADS_TEXT_VERSION, since: null } };

describe('the banner’s advertising choice (GET / POST /api/v1/consent)', () => {
  let h: Harness;
  let fake: FakeAds;
  let admin: { type: 'admin'; id: string };

  beforeAll(async () => {
    fake = await startFakeAds();
    h = await createHarness({ config: { ads: KEYS }, context: { adsTestOrigin: fake.origin } });
    admin = { type: 'admin', id: (await createAdmin(h.ctx, 'ADMIN')).id };
  });
  afterAll(async () => {
    await h?.close();
    await fake?.close();
  });

  const rows = () => h.ctx.db.selectFrom('ad_consents').selectAll().orderBy('id').execute();
  const clicks = () => h.ctx.db.selectFrom('ad_clicks').select(['kind', 'click_id', 'account_id', 'device_id']).orderBy('kind').execute();
  const accountOf = async (email: string) => (await h.ctx.db.selectFrom('accounts').select('id').where('email', '=', email).executeTakeFirstOrThrow()).id;

  it('off: answers off and sets no cookie; a choice is refused (409 ADS_OFF) with nothing written', async () => {
    const c = h.client();
    const get = await c.get('/api/v1/consent');
    expect(get.statusCode).toBe(200);
    expect(safeJson(get)).toEqual(OFF);
    expect(get.headers['cache-control']).toBe('no-store');
    expect(get.cookies).toEqual([]);
    const post = await c.post('/api/v1/consent', { choice: 'GRANTED', clicks: { fbclid: 'IwAR0off' } });
    expect(post.statusCode).toBe(409);
    expect(errorOf(post).code).toBe('ADS_OFF');
    expect(post.cookies).toEqual([]);
    expect(await rows()).toEqual([]);
    expect(await clicks()).toEqual([]);
    expect(await h.ctx.db.selectFrom('tracking_devices').select('id').execute()).toEqual([]);
  });

  it('refuses a choice from another site (403) and a body it does not know (400)', async () => {
    const foreign = h.client({ origin: 'https://evil.example' });
    const res = await foreign.post('/api/v1/consent', { choice: 'GRANTED' });
    expect(res.statusCode).toBe(403);
    for (const body of [{}, { choice: 'YES' }, { choice: 'GRANTED', extra: 1 }, { choice: 'GRANTED', clicks: { fbclid: 'has space' } }, { choice: 'GRANTED', clicks: { msclkid: 'x' } }]) {
      const r = await h.client().post('/api/v1/consent', body);
      expect([r.statusCode, errorOf(r).code], JSON.stringify(body)).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it('on: the banner’s choice of a device signed out, its click ids and user agent; taken by the account at its sign-up', async () => {
    await h.ctx.services.ads.setSwitch(true, 'SWITCH ON', admin);
    // The Paris day of the switch on, which /legal/privacy shows under its version line (step M4.14).
    const since = parisDay(h.clock.now());
    const c = h.client();
    expect(safeJson(await c.get('/api/v1/consent'))).toEqual({ ads: { on: true, choice: null, textVersion: ADS_TEXT_VERSION, since } });
    const post = await c.post('/api/v1/consent', { choice: 'GRANTED', clicks: { fbclid: 'IwAR0banner', gclid: 'Cj0Kbanner' } });
    expect(post.statusCode).toBe(200);
    expect(safeJson(post)).toEqual({ ads: { on: true, choice: 'GRANTED', textVersion: ADS_TEXT_VERSION, since } });
    expect(post.cookies.map((x) => x.name)).toEqual(['orbes_device']);
    const [row] = await rows();
    expect(row).toMatchObject({ account_id: null, choice: 'GRANTED', source: 'BANNER', text_version: ADS_TEXT_VERSION });
    expect(row!.device_id).not.toBeNull();
    expect(row!.user_agent).toMatch(/^Mozilla\/5\.0 \(iPhone/);
    expect(await clicks()).toEqual([
      { kind: 'FBCLID', click_id: 'IwAR0banner', account_id: null, device_id: row!.device_id },
      { kind: 'GCLID', click_id: 'Cj0Kbanner', account_id: null, device_id: row!.device_id },
    ]);
    expect(safeJson(await c.get('/api/v1/consent'))).toMatchObject({ ads: { choice: 'GRANTED' } });

    // Its sign-up on that device: the choice and the click ids become the account's.
    const email = 'banner-ads@example.com';
    expect((await c.post('/api/v1/account/register', { email, password: PASSWORD, firstName: 'Banner', lastName: 'Ads', country: 'FR' })).statusCode).toBe(201);
    const account = await accountOf(email);
    const carried = (await rows()).filter((r) => r.account_id === account);
    expect(carried).toEqual([expect.objectContaining({ device_id: row!.device_id, choice: 'GRANTED', source: 'BANNER', chosen_at: row!.chosen_at, user_agent: row!.user_agent })]);
    expect((await clicks()).map((k) => k.account_id)).toEqual([account, account]);
    expect(safeJson(await c.get('/api/v1/consent'))).toMatchObject({ ads: { on: true, choice: 'GRANTED' } });

    // A device that declines signed out, then signs in on an account without a choice: the account declines too.
    const d = h.client();
    expect((await d.post('/api/v1/account/register', { email: 'other-ads@example.com', password: PASSWORD, firstName: 'Other', lastName: 'Ads', country: 'FR' })).statusCode).toBe(201);
    await d.post('/api/v1/account/logout');
    expect(safeJson(await d.post('/api/v1/consent', { choice: 'DECLINED', clicks: { ttclid: 'never-kept' } }))).toMatchObject({ ads: { choice: 'DECLINED' } });
    expect((await clicks()).some((k) => k.click_id === 'never-kept')).toBe(false);
    expect((await d.post('/api/v1/account/login', { email: 'other-ads@example.com', password: PASSWORD })).statusCode).toBe(200);
    expect(safeJson(await d.get('/api/v1/consent'))).toMatchObject({ ads: { choice: 'DECLINED' } });
  });

  it('the housekeeping enqueues the sign-up right after the conversions, and the sender sends it to the platform its click id names', async () => {
    const hk = startHousekeeping(h.ctx, { intervalMs: 3_600_000 });
    try {
      const account = await accountOf('banner-ads@example.com');
      const signup = await h.ctx.db.selectFrom('acquisition_conversions').select('id').where('kind', '=', 'SIGNUP').where('account_id', '=', account).executeTakeFirstOrThrow();
      const r = await hk.runOnce();
      // META by its fbclid; GOOGLE by its gclid, its keys missing here: SKIPPED, NOT_READY.
      expect(r.adsEnqueue).toBe(2);
      expect(await h.ctx.db.selectFrom('ad_events').select(['platform', 'kind', 'status', 'skip_reason']).where('conversion_id', '=', signup.id).orderBy('platform').execute()).toEqual([
        { platform: 'GOOGLE', kind: 'SIGNUP', status: 'SKIPPED', skip_reason: 'NOT_READY' },
        { platform: 'META', kind: 'SIGNUP', status: 'QUEUED', skip_reason: null },
      ]);
      expect((await hk.runOnce()).adsEnqueue).toBe(0);
      fake.reset();
      expect(await h.ctx.services.ads.sendDue(h.clock.now())).toMatchObject({ sent: 1 });
      const sent = (fake.requests[0]!.json as { data: { event_id: string; event_name: string; user_data: { fbc: string } }[] }).data[0]!;
      expect(sent).toMatchObject({ event_id: `orbes-${signup.id}`, event_name: 'CompleteRegistration', user_data: { fbc: expect.stringMatching(/\.IwAR0banner$/) } });
    } finally {
      await hk.stop();
    }
  });

  it('audits no choice: the row is the record', async () => {
    expect(await h.ctx.db.selectFrom('audit_logs').select('action').where('action', 'like', '%consent%').execute()).toEqual([]);
  });
});
