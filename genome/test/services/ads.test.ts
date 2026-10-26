/**
 * The server-side conversions (macro scope K27 A1 to A5, S2; lot M4 plan §3.1, §3.2, §3.6, §3.7, step M4.11;
 * services/ads.ts), against the local fake platforms (test/support/fake-ads.ts), on a manual clock:
 *
 *  - off (the default): nothing queued from a conversion with a choice, no choice taken (409 ADS_OFF), no click id
 *    stored, nothing sent, the state off; SWITCH ON refused with no platform's keys (409 ADS_NO_PLATFORM) and without
 *    its phrase;
 *  - on: `events_from` (no backfill: an act before the first switch on is never sent); each kind once per platform it
 *    goes to: the last link's channel mapped, a click id clicked within 90 days before the act, neither (none), never
 *    every platform for every act; a pass repeated writes nothing; sent with the event id `orbes-<conversion id>` (a
 *    platform deduplicates a retry);
 *  - the consent at the act's time: granted after the act, nothing; declined after it, the queued event cancelled;
 *  - the device's choice made signed out taken by the account at its sign-up (carry), its click ids with it, by the
 *    first account to sign in after it only (a shared device);
 *  - state's precedence: the account's latest choice when signed in, else the device's;
 *  - a paid order: PAID_ORDER with the main invoice's total; an ORDER conversion recorded while its order is unpaid and
 *    PAID on a later pass, enqueued once, as PAID_ORDER, with its value (the watermark and the became-PAID pass);
 *  - adsSendsFor: GIFT, EXCHANGE, a VAULT order at 0 and a Shopify order never; a RIGHT TO BUY order sent; an order
 *    cancelled before the pass never queued, one cancelled before the send cancelled by the sender;
 *  - test entrants, the team's own accounts and LOCKED accounts never (a lock cancels what is queued);
 *  - TOO_OLD, NO_CLICK_ID, NOT_READY (keys missing, or Google's action not named);
 *  - retries (1 min, 5 min, 30 min, 2 h) then FAILED, its error scrubbed of the token;
 *  - SWITCH OFF cancels what is queued; the console's read (readiness true or false, never a key) and events;
 *  - a switch off (even switched on again) or a DECLINED landing during a pass: nothing more sent after it, the event a
 *    platform took reads SENT; no carry while off; a shared device's later choice made signed in not handed on;
 *  - the purge; the right of access's three parts; the audit (never a key, never an account); SEND A TEST EVENT;
 *  - ADS_TEXT_VERSION equal to the web's (web/legal/content/privacy-ads.ts).
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashEmail, type AdEvent } from '../../src/server/ads/event.js';
import type { AdsConfig } from '../../src/server/config.js';
import type { Db } from '../../src/server/db/connection.js';
import type { AdClickKind, AdConsentChoice, ConversionKind } from '../../src/server/db/schema.js';
import { DomainError } from '../../src/server/errors.js';
import { AcquisitionService } from '../../src/server/services/acquisition.js';
import {
  AD_CANCELLED_WORDS,
  accountAdsData,
  ADS_SENDER,
  ADS_TEXT_VERSION,
  adsSendsFor,
  AdsService,
  cancelAccountAdEvents,
  clicksOf,
  platformsFor,
  recordedUserAgent,
} from '../../src/server/services/ads.js';
import { AuditService } from '../../src/server/services/audit.js';
import { LinkService } from '../../src/server/services/links.js';
import { PlaceService } from '../../src/server/services/places.js';
import { parisDay } from '../../src/server/services/schedule.js';
import { TrackingService } from '../../src/server/services/tracking.js';
import { createManualClock, type Actor } from '../../src/server/types.js';
import { ADS_TEXT_VERSION as WEB_ADS_TEXT_VERSION } from '../../src/web/legal/content/privacy-ads.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { FAKE_ADS_PATHS, startFakeAds, type FakeAds } from '../support/fake-ads.js';
import { MarginWorld } from '../support/margin.js';

const KEYS: AdsConfig = {
  meta: { datasetId: '123456789012345', accessToken: 'META-SECRET-TOKEN-0123456789' },
  tiktok: { pixelCode: 'CTESTPIXEL0001', accessToken: 'TIKTOK-SECRET-TOKEN-0123456789' },
  google: { customerId: '1234567890', loginCustomerId: null, developerToken: 'GOOGLE-DEV-TOKEN-0123', clientId: 'client-id.apps', clientSecret: 'GOOGLE-CLIENT-SECRET-0123', refreshToken: 'GOOGLE-REFRESH-TOKEN-0123' },
};
const NONE: AdsConfig = { meta: null, tiktok: null, google: null };
const SECRET = 'ads-test-cookie-secret-0123456789abcdef';
const ORIGIN = 'https://verify.theorbes.com';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
const MIN = 60_000;
const DAY = 86_400_000;
const GOOGLE_ACTION = 'customers/1234567890/conversionActions/111';

async function refusal(p: Promise<unknown>): Promise<{ code: string; status: number }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, status: e.httpStatus };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('AdsService (K27, plan §3.2)', () => {
  let t: TestDb;
  let db: Db;
  let fake: FakeAds;
  let w: MarginWorld;
  let ads: AdsService;
  let actor: Actor;
  let model: string;
  let sku: string;
  const clock = createManualClock('2026-11-02T08:00:00.000Z');
  const ch: Record<'instagram' | 'tiktok' | 'press', string> = { instagram: '', tiktok: '', press: '' };
  const src: Record<'instagram' | 'tiktok' | 'press', number> = { instagram: 0, tiktok: 0, press: 0 };

  const now = () => clock.now();
  /** The Paris day of the switch on in force (the state's `since`, /legal/privacy's line under its version). */
  const since = async (): Promise<string> => parisDay((await db.selectFrom('ads_settings').select('switched_at').where('id', '=', 1).executeTakeFirstOrThrow()).switched_at!);
  const ago = (ms: number) => new Date(clock.now().getTime() - ms);
  const make = (keys: AdsConfig) => new AdsService({ db, audit: new AuditService({ db, clock: clock.now }), keys, cookieSecret: SECRET, publicOrigin: ORIGIN, clock: clock.now, testOrigin: fake.origin });

  /** A collector's account, ACTIVE, in France. */
  const account = async (): Promise<string> => w.g.account('2026-09-01', 'FR');
  /** A choice of the account, made at `at` (the row as the service writes it). */
  const choice = async (accountId: string, at: Date, c: AdConsentChoice = 'GRANTED'): Promise<void> => {
    await db.insertInto('ad_consents').values({ account_id: accountId, choice: c, source: 'BANNER', text_version: ADS_TEXT_VERSION, user_agent: c === 'GRANTED' ? UA : null, chosen_at: at }).execute();
  };
  const device = async (): Promise<number> =>
    Number((await db.insertInto('tracking_devices').values({ device_hash: randomUUID().replace(/-/g, '').padEnd(43, 'x'), first_seen_at: now(), last_seen_at: now() }).returning('id').executeTakeFirstOrThrow()).id);
  /** A click id the account holds, read at `at`. */
  const click = async (accountId: string, kind: AdClickKind, id: string, at: Date): Promise<void> => {
    await db.insertInto('ad_clicks').values({ device_id: await device(), account_id: accountId, kind, click_id: id, clicked_at: at }).execute();
  };
  /** A conversion as recordConversions writes it: its act at `at`, its last link's source, written now. */
  const conversion = async (kind: ConversionKind, accountId: string, source: number, at: Date, refId: string = randomUUID()): Promise<number> =>
    Number(
      (
        await db
          .insertInto('acquisition_conversions')
          .values({ kind, ref_id: kind === 'SIGNUP' ? accountId : refId, account_id: accountId, at, last_source_id: source, created_at: now() })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id,
    );
  /** A salon order paid now (its main invoice `total`), and its ORDER conversion. */
  const paidOrder = async (accountId: string, source: number, total: number, o: { channel?: 'SALON' | 'VAULT'; vaultId?: string; claimBy?: string; currency?: string } = {}) => {
    const id = await w.order({
      accountId,
      modelId: model,
      channel: o.channel ?? 'SALON',
      paid: now().toISOString(),
      currency: o.currency ?? 'EUR',
      skuId: sku,
      ...(o.vaultId ? { vaultId: o.vaultId } : {}),
      ...(o.claimBy ? { claimBy: o.claimBy } : {}),
      lines: [{ kind: 'PIECE', label: 'PIECE', detail: null, amountMinor: total }],
    });
    return { id, conversion: await conversion('ORDER', accountId, source, ago(MIN), id) };
  };
  const eventsOf = async (conversionId: number) =>
    (await db.selectFrom('ad_events').select(['platform', 'kind', 'status', 'skip_reason']).where('conversion_id', '=', conversionId).orderBy('platform').execute()).map((e) => ({ ...e }));
  /** The housekeeping's next pass: 10 minutes later, enqueue. */
  const pass = async (service: AdsService = ads) => {
    clock.advance(10 * MIN);
    return service.enqueue(now());
  };

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
    fake = await startFakeAds();
    await new AcquisitionService({ db, publicOrigin: ORIGIN, clock: () => new Date('2026-06-01T08:00:00.000Z') }).prepare();
    const admin = (await db.insertInto('admin_users').values({ email: 'ads-admin@orbes.test', email_normalized: 'ads-admin@orbes.test', password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow()).id;
    actor = { type: 'admin', id: admin };
    w = await new MarginWorld(db, admin).prepare();
    model = await w.model('ADSMODEL');
    sku = await w.sku(model, null);
    for (const [key, name] of [['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['press', 'Press']] as const) {
      ch[key] = (await db.selectFrom('link_channels').select('id').where('name', '=', name).executeTakeFirstOrThrow()).id;
      const link = await db.insertInto('links').values({ code: `ads-${key}`, name: key, channel_id: ch[key], destination: 'NOW', created_by: admin }).returning('id').executeTakeFirstOrThrow();
      src[key] = Number((await db.insertInto('acquisition_sources').values({ kind: 'LINK', link_id: link.id, key: `L:${link.id}` }).returning('id').executeTakeFirstOrThrow()).id);
    }
    ads = make(KEYS);
  });
  afterAll(async () => {
    await fake?.close();
    await t?.close();
  });

  it('holds its text version equal to the web’s, and its pure rules', () => {
    expect(ADS_TEXT_VERSION).toBe(WEB_ADS_TEXT_VERSION);
    expect(ADS_TEXT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const order = { channel: 'SALON' as const, price_minor: 48_000, shopify_order_id: null, exchange_of_order_id: null };
    expect(adsSendsFor(order)).toBe(true);
    expect(adsSendsFor({ ...order, channel: 'LIVE' })).toBe(true);
    expect(adsSendsFor({ ...order, channel: 'GIFT', price_minor: 0 })).toBe(false);
    expect(adsSendsFor({ ...order, channel: 'EXCHANGE' })).toBe(false);
    expect(adsSendsFor({ ...order, exchange_of_order_id: randomUUID() })).toBe(false);
    expect(adsSendsFor({ ...order, channel: 'VAULT', price_minor: 0 })).toBe(false);
    expect(adsSendsFor({ ...order, channel: 'VAULT', price_minor: 90_000 })).toBe(true);
    expect(adsSendsFor({ ...order, shopify_order_id: '5551234' })).toBe(false);
    // Only the platforms the collector came from: the mapping, a click id; never every platform for every act.
    expect(platformsFor([], [])).toEqual([]);
    expect(platformsFor(['META'], [])).toEqual(['META']);
    expect(platformsFor([], ['GBRAID'])).toEqual(['GOOGLE']);
    expect(platformsFor(['TIKTOK'], ['FBCLID', 'TTCLID'])).toEqual(['META', 'TIKTOK']);
    expect(clicksOf({ fbclid: 'IwAR0abc', gclid: 'has space', wbraid: '' })).toEqual([{ kind: 'FBCLID', id: 'IwAR0abc' }]);
    expect(recordedUserAgent(` ${'x'.repeat(500)}\n`)).toHaveLength(400);
    expect(recordedUserAgent('  ')).toBeNull();
  });

  it('off (the default): nothing queued, no choice taken, no click id stored, nothing sent', async () => {
    const a = await account();
    await choice(a, ago(MIN));
    const c = await conversion('SIGNUP', a, src.instagram, ago(MIN));
    await ads.setChannelPlatforms(ch.instagram, ['META'], actor);
    expect(await pass()).toEqual({ queued: 0, skipped: 0 });
    expect(await eventsOf(c)).toEqual([]);
    expect(await refusal(ads.choose({ deviceId: null, accountId: a, choice: 'GRANTED', source: 'BANNER', userAgent: UA, clicks: { fbclid: 'IwAR0off' } }))).toEqual({ code: 'ADS_OFF', status: 409 });
    expect(await refusal(ads.requireOn())).toEqual({ code: 'ADS_OFF', status: 409 });
    expect(await db.selectFrom('ad_clicks').select('id').execute()).toEqual([]);
    expect(await ads.state(null, a)).toEqual({ on: false, choice: null, textVersion: ADS_TEXT_VERSION, since: null });
    expect(await ads.sendDue(now())).toEqual({ sent: 0, retried: 0, failed: 0, skipped: 0, cancelled: 0 });
    expect(fake.requests).toEqual([]);
    expect(await refusal(ads.sendTest('META', actor))).toEqual({ code: 'ADS_OFF', status: 409 });
    // Switching on: refused with no platform's keys, and without its phrase.
    expect(await refusal(make(NONE).setSwitch(true, 'SWITCH ON', actor))).toEqual({ code: 'ADS_NO_PLATFORM', status: 409 });
    expect(await refusal(ads.setSwitch(true, 'SWITCH OFF', actor))).toEqual({ code: 'VALIDATION_FAILED', status: 400 });
    expect((await ads.read()).on).toBe(false);
  });

  it('on: events_from set at the first switch on; an act before it is never sent (no backfill)', async () => {
    const before = await account();
    await choice(before, ago(DAY));
    const early = await conversion('SIGNUP', before, src.instagram, ago(5 * MIN));
    const view = await ads.setSwitch(true, 'switch on', actor);
    expect(view).toMatchObject({ on: true, eventsFrom: now(), switchedAt: now(), switchedBy: { id: actor.id, email: 'ads-admin@orbes.test' } });
    // The collector app and /legal/privacy read the Paris day of the switch on (step M4.14).
    expect(await ads.state(null, before)).toEqual({ on: true, choice: 'GRANTED', textVersion: ADS_TEXT_VERSION, since: parisDay(now()) });
    expect(await pass()).toEqual({ queued: 0, skipped: 0 });
    expect(await eventsOf(early)).toEqual([]);
    // Written after the switch, but acted before it: still never.
    const late = await conversion('DRAW_ENTRY', before, src.instagram, new Date(view.eventsFrom!.getTime() - MIN));
    await pass();
    expect(await eventsOf(late)).toEqual([]);
  });

  it('sends each act once to each platform the collector came from: the mapped channel, a click id within 90 days; neither, none', async () => {
    await ads.setChannelPlatforms(ch.tiktok, ['TIKTOK'], actor);
    await ads.setGoogleActions({ SIGNUP: GOOGLE_ACTION, PAID_ORDER: 'customers/1234567890/conversionActions/444' }, actor);
    // B, no click id: Instagram → META, TikTok → TIKTOK, Press (not mapped) → none.
    const b = await account();
    await choice(b, ago(DAY));
    const bSignup = await conversion('SIGNUP', b, src.instagram, ago(MIN));
    const bDraw = await conversion('DRAW_ENTRY', b, src.tiktok, ago(MIN));
    const bLive = await conversion('LIVE_ENTRY', b, src.press, ago(MIN));
    // C, a ttclid 30 days before and a gclid 100 days before (too far): through Press, TIKTOK only.
    const c = await account();
    await choice(c, ago(200 * DAY));
    await click(c, 'TTCLID', 'E.C.P.tiktokclick', ago(30 * DAY));
    await click(c, 'GCLID', 'Cj0KoldGclid', ago(100 * DAY));
    const cSignup = await conversion('SIGNUP', c, src.press, ago(MIN));
    // D, a gclid 5 days before: Instagram → META, and GOOGLE by its click id.
    const d = await account();
    await choice(d, ago(10 * DAY));
    await click(d, 'GCLID', 'Cj0KdGclid', ago(5 * DAY));
    const dSignup = await conversion('SIGNUP', d, src.instagram, ago(MIN));
    expect(await pass()).toEqual({ queued: 5, skipped: 0 });
    expect(await eventsOf(bSignup)).toEqual([{ platform: 'META', kind: 'SIGNUP', status: 'QUEUED', skip_reason: null }]);
    expect(await eventsOf(bDraw)).toEqual([{ platform: 'TIKTOK', kind: 'DRAW_ENTRY', status: 'QUEUED', skip_reason: null }]);
    expect(await eventsOf(bLive)).toEqual([]);
    expect(await eventsOf(cSignup)).toEqual([{ platform: 'TIKTOK', kind: 'SIGNUP', status: 'QUEUED', skip_reason: null }]);
    expect(await eventsOf(dSignup)).toEqual([
      { platform: 'GOOGLE', kind: 'SIGNUP', status: 'QUEUED', skip_reason: null },
      { platform: 'META', kind: 'SIGNUP', status: 'QUEUED', skip_reason: null },
    ]);
    // A pass repeated (its overlap reaches back over them) writes nothing twice.
    expect(await pass()).toEqual({ queued: 0, skipped: 0 });

    fake.reset();
    expect(await ads.sendDue(now())).toEqual({ sent: 5, retried: 0, failed: 0, skipped: 0, cancelled: 0 });
    const meta = fake.requests.filter((r) => FAKE_ADS_PATHS.meta.test(r.path)).map((r) => (r.json as { data: { event_id: string; event_name: string; user_data: { em: string[] } }[] }).data[0]!);
    expect(meta.map((e) => e.event_id).sort()).toEqual([`orbes-${bSignup}`, `orbes-${dSignup}`].sort());
    expect(meta.every((e) => e.event_name === 'CompleteRegistration')).toBe(true);
    const tiktok = fake.requests.filter((r) => FAKE_ADS_PATHS.tiktok.test(r.path)).map((r) => (r.json as { data: { event: string; event_id: string; user: { ttclid?: string } }[] }).data[0]!);
    expect(tiktok.map((e) => [e.event_id, e.event]).sort()).toEqual([[`orbes-${bDraw}`, 'SubmitForm'], [`orbes-${cSignup}`, 'CompleteRegistration']].sort());
    expect(tiktok.find((e) => e.event_id === `orbes-${cSignup}`)?.user.ttclid).toBe('E.C.P.tiktokclick');
    const google = fake.requests.filter((r) => FAKE_ADS_PATHS.google.test(r.path)).map((r) => (r.json as { conversions: { conversionAction: string; gclid: string; orderId: string }[] }).conversions[0]!);
    expect(google).toEqual([expect.objectContaining({ conversionAction: GOOGLE_ACTION, gclid: 'Cj0KdGclid', orderId: `orbes-${dSignup}` })]);
    // No key in a URL, ever.
    for (const r of fake.requests) for (const secret of [KEYS.meta!.accessToken, KEYS.tiktok!.accessToken, KEYS.google!.refreshToken]) expect(r.path).not.toContain(secret);
    const sent = await db.selectFrom('ad_events').select(['status', 'sent_at', 'settled_at']).where('conversion_id', 'in', [bSignup, bDraw, cSignup, dSignup]).execute();
    expect(sent.every((e) => e.status === 'SENT' && e.sent_at !== null && e.settled_at !== null)).toBe(true);
  });

  it('reads the consent at the act’s time: granted after the act, nothing; declined after it, what is queued is cancelled', async () => {
    const late = await account();
    const act = await conversion('SIGNUP', late, src.instagram, ago(2 * MIN));
    await choice(late, ago(MIN));
    const withdrawn = await account();
    await choice(withdrawn, ago(DAY));
    const queued = await conversion('SIGNUP', withdrawn, src.instagram, ago(MIN));
    await pass();
    expect(await eventsOf(act)).toEqual([]);
    expect(await eventsOf(queued)).toEqual([{ platform: 'META', kind: 'SIGNUP', status: 'QUEUED', skip_reason: null }]);
    await ads.choose({ deviceId: null, accountId: withdrawn, choice: 'DECLINED', source: 'ACCOUNT', userAgent: UA });
    expect(await eventsOf(queued)).toEqual([{ platform: 'META', kind: 'SIGNUP', status: 'CANCELLED', skip_reason: null }]);
    expect(await ads.state(null, withdrawn)).toEqual({ on: true, choice: 'DECLINED', textVersion: ADS_TEXT_VERSION, since: await since() });
  });

  it('cancels at send time an event whose collector withdrew since it was queued', async () => {
    const a = await account();
    await choice(a, ago(DAY));
    const c = await conversion('SIGNUP', a, src.instagram, ago(MIN));
    await pass();
    // A withdrawal written straight in the table (as from another process): the sender reads the choice again.
    await choice(a, now(), 'DECLINED');
    fake.reset();
    expect(await ads.sendDue(now())).toMatchObject({ cancelled: 1, sent: 0 });
    expect(fake.requests).toEqual([]);
    expect(await db.selectFrom('ad_events').select(['status', 'last_error']).where('conversion_id', '=', c).executeTakeFirst()).toEqual({ status: 'CANCELLED', last_error: 'The collector withdrew their consent.' });
  });

  it('takes the device’s choice made signed out to the account at its sign-up, with its click ids; the state reads the account first', async () => {
    const dev = await device();
    clock.advance(MIN);
    const state = await ads.choose({ deviceId: dev, accountId: null, choice: 'GRANTED', source: 'BANNER', userAgent: UA, clicks: { fbclid: 'IwAR0carried', ttclid: 'tt carried' } });
    expect(state).toEqual({ on: true, choice: 'GRANTED', textVersion: ADS_TEXT_VERSION, since: await since() });
    // The malformed ttclid (a space) dropped; the fbclid kept on the device.
    expect(await db.selectFrom('ad_clicks').select(['kind', 'click_id', 'account_id']).where('device_id', '=', dev).execute()).toEqual([{ kind: 'FBCLID', click_id: 'IwAR0carried', account_id: null }]);
    const chosenAt = now();
    clock.advance(MIN);
    const a = await account();
    // Signed in, the account's own choice comes first: none yet; signed out, the device's.
    expect(await ads.state(dev, a)).toMatchObject({ choice: null });
    expect(await ads.state(dev, null)).toMatchObject({ choice: 'GRANTED' });
    await db.transaction().execute((tx) => ads.carry(tx, dev, a));
    expect(await db.selectFrom('ad_consents').select(['device_id', 'account_id', 'choice', 'source', 'user_agent', 'chosen_at']).where('account_id', '=', a).execute()).toEqual([
      { device_id: dev, account_id: a, choice: 'GRANTED', source: 'BANNER', user_agent: UA, chosen_at: chosenAt },
    ]);
    expect(await db.selectFrom('ad_clicks').select('account_id').where('device_id', '=', dev).execute()).toEqual([{ account_id: a }]);
    // Carried again (a later sign-in): nothing more, the account's choice is not older.
    await db.transaction().execute((tx) => ads.carry(tx, dev, a));
    expect(await db.selectFrom('ad_consents').select('id').where('account_id', '=', a).execute()).toHaveLength(1);
    // Its sign-up, after the choice: sent to META by the fbclid's platform, the user agent recorded with the consent.
    const signup = await conversion('SIGNUP', a, src.press, ago(30_000));
    await pass();
    expect(await eventsOf(signup)).toEqual([{ platform: 'META', kind: 'SIGNUP', status: 'QUEUED', skip_reason: null }]);
    fake.reset();
    await ads.sendDue(now());
    const sent = (fake.requests[0]!.json as { data: { user_data: { fbc: string; client_user_agent: string; em: string[] } }[] }).data[0]!.user_data;
    expect(sent.fbc).toBe(`fb.1.${chosenAt.getTime()}.IwAR0carried`);
    expect(sent.client_user_agent).toBe(UA);
    const email = (await db.selectFrom('accounts').select('email').where('id', '=', a).executeTakeFirstOrThrow()).email;
    expect(sent.em).toEqual([hashEmail(email)]);
    // A device whose later choice is DECLINED: the account takes the refusal, the device's click ids go.
    const dev2 = await device();
    const b = await account();
    await db.insertInto('ad_clicks').values({ device_id: dev2, account_id: null, kind: 'GCLID', click_id: 'Cj0Kdeclined', clicked_at: ago(MIN) }).execute();
    await ads.choose({ deviceId: dev2, accountId: null, choice: 'DECLINED', source: 'BANNER', userAgent: UA });
    expect(await db.selectFrom('ad_clicks').select('id').where('device_id', '=', dev2).execute()).toEqual([]);
    await db.transaction().execute((tx) => ads.carry(tx, dev2, b));
    expect(await ads.state(null, b)).toMatchObject({ choice: 'DECLINED' });
    // A shared device: a choice made signed out is carried to the first account to sign in after it only; the next
    // account is asked again (the copy already carried hands it on), as it is once someone chose on it signed in, later.
    const dev4 = await device();
    await ads.choose({ deviceId: dev4, accountId: null, choice: 'GRANTED', source: 'BANNER', userAgent: UA });
    clock.advance(MIN);
    const [first, next] = [await account(), await account()];
    await db.transaction().execute((tx) => ads.carry(tx, dev4, first));
    await db.transaction().execute((tx) => ads.carry(tx, dev4, next));
    expect([await ads.state(null, first), await ads.state(null, next)].map((x) => x.choice)).toEqual(['GRANTED', null]);
    const dev3 = await device();
    await ads.choose({ deviceId: dev3, accountId: null, choice: 'GRANTED', source: 'BANNER', userAgent: UA });
    clock.advance(MIN);
    const [declining, after] = [await account(), await account()];
    await ads.choose({ deviceId: dev3, accountId: declining, choice: 'DECLINED', source: 'ACCOUNT', userAgent: UA });
    await db.transaction().execute((tx) => ads.carry(tx, dev3, after));
    expect(await ads.state(null, after)).toMatchObject({ choice: null });
  });

  it('sends a paid order as PAID_ORDER with its main invoice’s total; one recorded unpaid and PAID on a later pass, once', async () => {
    const e = await account();
    await choice(e, ago(DAY));
    const paid = await paidOrder(e, src.instagram, 48_000, { currency: 'GBP' });
    // An order recorded while unpaid (RESERVED): its conversion written now, nothing to send yet.
    const reserved = await w.order({ accountId: e, modelId: model, channel: 'SALON', paid: now().toISOString(), unpaid: true, currency: 'EUR', skuId: sku, lines: [] });
    const reservedConversion = await conversion('ORDER', e, src.instagram, ago(MIN), reserved);
    await pass();
    expect(await eventsOf(paid.conversion)).toEqual([{ platform: 'META', kind: 'PAID_ORDER', status: 'QUEUED', skip_reason: null }]);
    expect(await eventsOf(reservedConversion)).toEqual([]);
    // Two passes later it is paid, its main invoice € 485 and a supplementary one (an engraving) € 20, not counted.
    await pass();
    clock.advance(MIN);
    await db.updateTable('orders').set({ status: 'PAID', paid_at: now(), reservation: null }).where('id', '=', reserved).execute();
    const main = await w.invoice(reserved, { kind: 'INVOICE', issued: now(), currency: 'EUR', lines: [{ kind: 'PIECE', label: 'PIECE', detail: null, amountMinor: 48_500 }] });
    await w.invoice(reserved, { kind: 'INVOICE', issued: now(), currency: 'EUR', supplements: main, lines: [{ kind: 'ENGRAVING', label: 'Engraving', detail: null, amountMinor: 2_000 }] });
    expect(await pass()).toEqual({ queued: 1, skipped: 0 });
    expect(await eventsOf(reservedConversion)).toEqual([{ platform: 'META', kind: 'PAID_ORDER', status: 'QUEUED', skip_reason: null }]);
    expect(await pass()).toEqual({ queued: 0, skipped: 0 });
    expect(await eventsOf(reservedConversion)).toHaveLength(1);
    fake.reset();
    await ads.sendDue(now());
    const bodies = fake.requests.map((r) => (r.json as { data: { event_id: string; event_name: string; custom_data: unknown }[] }).data[0]!);
    expect(bodies.find((b) => b.event_id === `orbes-${reservedConversion}`)).toMatchObject({ event_name: 'Purchase', custom_data: { value: 485, currency: 'EUR' } });
    expect(bodies.find((b) => b.event_id === `orbes-${paid.conversion}`)).toMatchObject({ event_name: 'Purchase', custom_data: { value: 480, currency: 'GBP' } });
  });

  it('never sends a GIFT, an EXCHANGE, a VAULT order at 0 nor a Shopify order; a RIGHT TO BUY order is sent', async () => {
    const f = await account();
    await choice(f, ago(DAY));
    const salon = await paidOrder(f, src.instagram, 30_000);
    const gift = await w.order({ accountId: f, modelId: model, channel: 'GIFT', paid: now().toISOString(), currency: 'EUR', withOrderId: salon.id, giftGrantId: await w.g.giftGrant(f, model, '2026-10-01'), skuId: sku });
    const giftConversion = await conversion('ORDER', f, src.instagram, ago(MIN), gift);
    const exchange = await w.order({ accountId: f, modelId: model, channel: 'EXCHANGE', paid: now().toISOString(), currency: 'EUR', exchangeOf: salon.id, skuId: sku, lines: [{ kind: 'PIECE', label: 'SIZE EXCHANGE', detail: null, amountMinor: 30_000 }] });
    const exchangeConversion = await conversion('ORDER', f, src.instagram, ago(MIN), exchange);
    const store = await paidOrder(f, src.instagram, 30_000);
    await db.updateTable('orders').set({ shopify_order_id: '5550001' }).where('id', '=', store.id).execute();
    const freeReward = await w.reward('PRODUCT', { modelId: model, mode: 'FREE' });
    const won = await w.vault(f, { given: '2026-10-01', opened: '2026-11-01', rewardId: freeReward, kind: 'PRODUCT', value: [30_000, 'EUR'] });
    const vaultAtZero = await paidOrder(f, src.instagram, 0, { channel: 'VAULT', vaultId: won, claimBy: '2026-12-01' });
    const buyReward = await w.reward('PRODUCT', { modelId: model, mode: 'RIGHT_TO_BUY' });
    const right = await w.vault(f, { given: '2026-10-01', opened: '2026-11-01', rewardId: buyReward, kind: 'PRODUCT', value: [30_000, 'EUR'], offerUntil: '2026-11-03', offerUsed: now().toISOString() });
    const rightToBuy = await paidOrder(f, src.instagram, 27_000, { channel: 'VAULT', vaultId: right });
    await pass();
    for (const never of [giftConversion, exchangeConversion, store.conversion, vaultAtZero.conversion]) expect(await eventsOf(never)).toEqual([]);
    expect(await eventsOf(salon.conversion)).toEqual([{ platform: 'META', kind: 'PAID_ORDER', status: 'QUEUED', skip_reason: null }]);
    expect(await eventsOf(rightToBuy.conversion)).toEqual([{ platform: 'META', kind: 'PAID_ORDER', status: 'QUEUED', skip_reason: null }]);
  });

  it('never sends a paid order cancelled or returned before the send: not queued, or cancelled at send time', async () => {
    const g = await account();
    await choice(g, ago(DAY));
    const cancel = (id: string) => db.updateTable('orders').set({ status: 'CANCELLED', cancelled_at: now() }).where('id', '=', id).execute();
    // Cancelled before the pass: never queued (as the attribution report counts a purchase).
    const before = await paidOrder(g, src.instagram, 30_000);
    await cancel(before.id);
    // Queued, then cancelled before the send: the sender cancels it and the platform receives nothing.
    const after = await paidOrder(g, src.instagram, 30_000);
    await pass();
    expect(await eventsOf(before.conversion)).toEqual([]);
    expect(await eventsOf(after.conversion)).toEqual([{ platform: 'META', kind: 'PAID_ORDER', status: 'QUEUED', skip_reason: null }]);
    await cancel(after.id);
    fake.reset();
    await ads.sendDue(now());
    expect(fake.requests.map((r) => JSON.stringify(r.json)).filter((b) => b.includes(`orbes-${after.conversion}`))).toEqual([]);
    expect(await db.selectFrom('ad_events').select(['status', 'sent_at', 'last_error']).where('conversion_id', '=', after.conversion).executeTakeFirstOrThrow()).toEqual({
      status: 'CANCELLED',
      sent_at: null,
      last_error: AD_CANCELLED_WORDS.orderCancelled,
    });
  });

  it('never sends a test entrant’s, the team’s own or a LOCKED account’s acts; a lock cancels what is queued', async () => {
    const entrant = await account();
    await db.insertInto('test_entrants').values({ account_id: entrant }).execute();
    const staff = await account();
    const staffEmail = (await db.selectFrom('accounts').select('email_normalized').where('id', '=', staff).executeTakeFirstOrThrow()).email_normalized;
    await db.insertInto('admin_users').values({ email: staffEmail, email_normalized: staffEmail, password_hash: 'scrypt$x', role: 'OPERATOR' }).execute();
    const locked = await account();
    await db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', locked).execute();
    const queued = await account();
    const acts: number[] = [];
    for (const a of [entrant, staff, locked, queued]) {
      await choice(a, ago(DAY));
      acts.push(await conversion('SIGNUP', a, src.instagram, ago(MIN)));
    }
    await pass();
    for (const act of acts.slice(0, 3)) expect(await eventsOf(act)).toEqual([]);
    expect(await eventsOf(acts[3]!)).toEqual([{ platform: 'META', kind: 'SIGNUP', status: 'QUEUED', skip_reason: null }]);
    // OwnerService.lock's call, in its transaction.
    expect(await db.transaction().execute((tx) => cancelAccountAdEvents(tx, queued, now()))).toBe(1);
    expect(await db.selectFrom('ad_events').select(['status', 'last_error', 'settled_at']).where('conversion_id', '=', acts[3]!).executeTakeFirst()).toEqual({ status: 'CANCELLED', last_error: 'The account was locked.', settled_at: now() });
  });

  it('skips with its reason: TOO_OLD past the platform’s age, NO_CLICK_ID for Google without a Google click id, NOT_READY', async () => {
    await ads.setChannelPlatforms(ch.press, ['META', 'GOOGLE'], actor);
    // Nine days after the first switch on.
    clock.advance(9 * DAY);
    await ads.sendDue(now());
    // An act of 8 days ago written now: too old for Meta (7 days), not for Google (90), but Google needs its click id.
    const old = await account();
    await choice(old, ago(30 * DAY));
    const oldAct = await conversion('DRAW_ENTRY', old, src.press, ago(8 * DAY));
    // A LIVE entry with a gclid: Google's action for LIVE_ENTRY is not named (NOT_READY).
    const unnamed = await account();
    await choice(unnamed, ago(30 * DAY));
    await click(unnamed, 'GCLID', 'Cj0Kunnamed', ago(DAY));
    const unnamedAct = await conversion('LIVE_ENTRY', unnamed, src.press, ago(MIN));
    expect(await pass()).toEqual({ queued: 1, skipped: 3 });
    expect(await eventsOf(oldAct)).toEqual([
      { platform: 'GOOGLE', kind: 'DRAW_ENTRY', status: 'SKIPPED', skip_reason: 'NO_CLICK_ID' },
      { platform: 'META', kind: 'DRAW_ENTRY', status: 'SKIPPED', skip_reason: 'TOO_OLD' },
    ]);
    expect(await eventsOf(unnamedAct)).toEqual([
      { platform: 'GOOGLE', kind: 'LIVE_ENTRY', status: 'SKIPPED', skip_reason: 'NOT_READY' },
      { platform: 'META', kind: 'LIVE_ENTRY', status: 'QUEUED', skip_reason: null },
    ]);
    await ads.sendDue(now());
    // A platform whose keys are missing: NOT_READY (a server with Meta's keys only, the same switch).
    await ads.setChannelPlatforms(ch.press, ['TIKTOK'], actor);
    const metaOnly = make({ ...NONE, meta: KEYS.meta });
    const g = await account();
    await choice(g, ago(DAY));
    const gAct = await conversion('SIGNUP', g, src.press, ago(MIN));
    await pass(metaOnly);
    expect(await eventsOf(gAct)).toEqual([{ platform: 'TIKTOK', kind: 'SIGNUP', status: 'SKIPPED', skip_reason: 'NOT_READY' }]);
    const settled = await db.selectFrom('ad_events').select(['settled_at', 'sent_at']).where('conversion_id', '=', gAct).executeTakeFirstOrThrow();
    expect(settled).toEqual({ settled_at: now(), sent_at: null });
    await ads.setChannelPlatforms(ch.press, [], actor);
  });

  it('tries a refused event again after 1 min, 5 min, 30 min and 2 h, then FAILED, its error without the token', async () => {
    // What the passes before left queued goes first.
    await ads.sendDue(now());
    const h = await account();
    await choice(h, ago(DAY));
    const act = await conversion('SIGNUP', h, src.instagram, ago(MIN));
    await pass();
    fake.reset();
    fake.answerAlways(FAKE_ADS_PATHS.meta, { status: 400, body: { error: { message: `Invalid OAuth access token ${KEYS.meta!.accessToken}.` } } });
    const delays = [...ADS_SENDER.retryMs];
    for (let attempt = 1; attempt <= 5; attempt++) {
      const report = await ads.sendDue(now());
      const row = await db.selectFrom('ad_events').select(['status', 'attempts', 'not_before', 'last_error']).where('conversion_id', '=', act).executeTakeFirstOrThrow();
      expect(row.attempts).toBe(attempt);
      expect(row.last_error).toMatch(/^HTTP 400: /);
      expect(row.last_error).not.toContain(KEYS.meta!.accessToken);
      if (attempt < 5) {
        expect(report).toMatchObject({ retried: 1, failed: 0 });
        expect(row.status).toBe('QUEUED');
        expect(row.not_before.getTime() - now().getTime()).toBe(delays[attempt - 1]);
        // Not before its time.
        expect(await ads.sendDue(now())).toMatchObject({ retried: 0, sent: 0 });
        clock.advance(delays[attempt - 1]!);
      } else {
        expect(report).toMatchObject({ failed: 1 });
        expect(row.status).toBe('FAILED');
      }
    }
    expect(fake.requests).toHaveLength(5);
    fake.reset();
    const view = await ads.read();
    expect(view.platforms.find((p) => p.platform === 'META')?.lastError?.error).toMatch(/^HTTP 400: .*\[removed\]/);
  });

  it('SWITCH OFF cancels every QUEUED event; the console reads readiness, never a key; on again, nothing done while off is queued', async () => {
    const i = await account();
    await choice(i, ago(DAY));
    const queued = await conversion('SIGNUP', i, src.instagram, ago(MIN));
    await pass();
    const off = await ads.setSwitch(false, 'SWITCH OFF', actor);
    expect(off.on).toBe(false);
    expect(await eventsOf(queued)).toEqual([{ platform: 'META', kind: 'SIGNUP', status: 'CANCELLED', skip_reason: null }]);
    // While off: an act, then switched on again: never queued; events_from never moves.
    const whileOff = await conversion('DRAW_ENTRY', i, src.instagram, ago(MIN));
    clock.advance(MIN);
    const on = await ads.setSwitch(true, 'SWITCH ON', actor);
    expect(on.eventsFrom!.getTime()).toBeLessThan(on.switchedAt!.getTime());
    await pass();
    expect(await eventsOf(whileOff)).toEqual([]);

    const view = await ads.read();
    expect(view.platforms.map((p) => [p.platform, p.ready, p.apiVersion])).toEqual([
      ['META', true, 'v24.0'],
      ['TIKTOK', true, 'v1.3'],
      ['GOOGLE', true, 'v22'],
    ]);
    expect(view.platforms[0]!.counts.CANCELLED).toBeGreaterThan(0);
    expect(view.channels.find((c) => c.id === ch.instagram)?.platforms).toEqual(['META']);
    expect(view.googleActions).toEqual({ SIGNUP: GOOGLE_ACTION, DRAW_ENTRY: null, LIVE_ENTRY: null, PAID_ORDER: 'customers/1234567890/conversionActions/444' });
    expect(view.consent.month).toBe('2026-11');
    const text = JSON.stringify(view);
    for (const secret of [KEYS.meta!.accessToken, KEYS.tiktok!.accessToken, KEYS.google!.refreshToken, KEYS.google!.clientSecret, KEYS.google!.developerToken, KEYS.meta!.datasetId]) expect(text).not.toContain(secret);
    expect((await make(NONE).read()).platforms.map((p) => p.ready)).toEqual([false, false, false]);
    // The events: latest first, filtered; no account, no email.
    const list = await ads.events({ status: 'CANCELLED', platform: 'META' });
    expect(list.events.length).toBeGreaterThan(0);
    expect(list.events.every((e) => e.status === 'CANCELLED' && e.platform === 'META')).toBe(true);
    expect(Object.keys(list.events[0]!).sort()).toEqual(['attempts', 'createdAt', 'id', 'kind', 'lastError', 'notBefore', 'platform', 'sentAt', 'settledAt', 'skipReason', 'status']);
  });

  it('sends nothing more once switched off or declined during a pass; an event the platform took reads SENT', async () => {
    await ads.sendDue(now());
    // META's sender stands in for the platform: it takes the event, then what `during` does lands while its answer is on its way.
    const took: string[] = [];
    let during: (() => Promise<unknown>) | null = null;
    const meta = {
      send: async (event: AdEvent) => {
        took.push(event.id);
        const f = during;
        during = null;
        if (f) await f();
        return { status: 200, answer: 'HTTP 200: {}' };
      },
    };
    const sender = new AdsService({ db, audit: new AuditService({ db, clock: clock.now }), keys: KEYS, cookieSecret: SECRET, publicOrigin: ORIGIN, clock: clock.now, testOrigin: fake.origin, senders: { META: meta } });
    const row = async (c: number) => db.selectFrom('ad_events').select(['status', 'sent_at', 'last_error']).where('conversion_id', '=', c).executeTakeFirstOrThrow();
    /** Two acts of one collector through Instagram (META), queued; the first goes first. */
    const two = async () => {
      clock.advance(3 * MIN);
      const a = await account();
      await choice(a, ago(DAY));
      const first = await conversion('SIGNUP', a, src.instagram, ago(2 * MIN));
      const second = await conversion('DRAW_ENTRY', a, src.instagram, ago(MIN));
      await pass();
      took.length = 0;
      return { a, first, second };
    };
    const sentAt = () => now();
    // Switched off while the first event's request is on its way: it reads SENT; the second is never sent.
    const off = await two();
    during = () => ads.setSwitch(false, 'SWITCH OFF', actor);
    expect(await sender.sendDue(now())).toMatchObject({ sent: 1, cancelled: 1 });
    expect(took).toEqual([`orbes-${off.first}`]);
    expect(await row(off.first)).toEqual({ status: 'SENT', sent_at: sentAt(), last_error: null });
    expect(await row(off.second)).toEqual({ status: 'CANCELLED', sent_at: null, last_error: AD_CANCELLED_WORDS.switchedOff });
    expect(await sender.sendDue(now())).toEqual({ sent: 0, retried: 0, failed: 0, skipped: 0, cancelled: 0 });
    // While off, no carry: a device's choice and click id made signed out stay on the device.
    const dev = await device();
    await db.insertInto('ad_consents').values({ device_id: dev, choice: 'GRANTED', source: 'BANNER', text_version: ADS_TEXT_VERSION, user_agent: UA, chosen_at: ago(MIN) }).execute();
    await db.insertInto('ad_clicks').values({ device_id: dev, kind: 'FBCLID', click_id: 'IwAR0whileoff', clicked_at: ago(MIN) }).execute();
    const carriedOff = await account();
    await db.transaction().execute((tx) => ads.carry(tx, dev, carriedOff));
    expect(await db.selectFrom('ad_consents').select('id').where('account_id', '=', carriedOff).execute()).toEqual([]);
    expect(await db.selectFrom('ad_clicks').select('account_id').where('device_id', '=', dev).execute()).toEqual([{ account_id: null }]);
    // Switched off and on again while the first is on its way: the second, cancelled by the off, is not sent.
    await ads.setSwitch(true, 'SWITCH ON', actor);
    const offOn = await two();
    during = async () => {
      await ads.setSwitch(false, 'SWITCH OFF', actor);
      await ads.setSwitch(true, 'SWITCH ON', actor);
    };
    expect(await sender.sendDue(now())).toMatchObject({ sent: 1, cancelled: 1 });
    expect(took).toEqual([`orbes-${offOn.first}`]);
    expect((await row(offOn.first)).status).toBe('SENT');
    expect(await row(offOn.second)).toEqual({ status: 'CANCELLED', sent_at: null, last_error: AD_CANCELLED_WORDS.switchedOff });
    // The collector declines while the first is on its way: the second is not sent; the right of access says so.
    const declined = await two();
    during = () => ads.choose({ deviceId: null, accountId: declined.a, choice: 'DECLINED', source: 'ACCOUNT', userAgent: UA });
    expect(await sender.sendDue(now())).toMatchObject({ sent: 1, cancelled: 1 });
    expect(took).toEqual([`orbes-${declined.first}`]);
    expect(await row(declined.first)).toEqual({ status: 'SENT', sent_at: sentAt(), last_error: null });
    expect(await row(declined.second)).toEqual({ status: 'CANCELLED', sent_at: null, last_error: AD_CANCELLED_WORDS.withdrawn });
    expect((await accountAdsData(db, declined.a)).events.map((e) => [e.kind, e.status])).toEqual([
      ['SIGNUP', 'SENT'],
      ['DRAW_ENTRY', 'CANCELLED'],
    ]);
    clock.advance(2 * MIN);
  });

  it('SEND A TEST EVENT: in the platform’s test mode, for the house’s test address, its answer shown', async () => {
    expect(await refusal(ads.sendTest('META', actor))).toEqual({ code: 'VALIDATION_FAILED', status: 400 });
    expect(await refusal(make({ ...NONE, meta: KEYS.meta }).sendTest('TIKTOK', actor))).toEqual({ code: 'ADS_NO_PLATFORM', status: 409 });
    await ads.setTestCodes({ meta: 'TEST12345', tiktok: 'TEST67890' }, actor);
    fake.reset();
    const r = await ads.sendTest('META', actor);
    expect(r).toMatchObject({ platform: 'META', ok: true, status: 200 });
    expect(r.answer).toMatch(/^HTTP 200: .*events_received/);
    const body = fake.requests[0]!.json as { test_event_code: string; data: { user_data: { em: string[] } }[] };
    expect(body.test_event_code).toBe('TEST12345');
    expect(body.data[0]!.user_data.em).toEqual([hashEmail('ads-test@theorbes.com')]);
    const google = await ads.sendTest('GOOGLE', actor);
    expect(google).toMatchObject({ platform: 'GOOGLE', ok: true });
    expect((fake.requests.find((x) => FAKE_ADS_PATHS.google.test(x.path))!.json as { validateOnly: boolean }).validateOnly).toBe(true);
    fake.answer(FAKE_ADS_PATHS.tiktok, { status: 200, body: { code: 40001, message: 'Invalid pixel' } });
    expect(await ads.sendTest('TIKTOK', actor)).toMatchObject({ platform: 'TIKTOK', ok: false, status: 200 });
    // No event row: a test is not an act.
    expect(await db.selectFrom('ad_events').select('id').where('kind', '=', 'SIGNUP').where('created_at', '=', now()).execute()).toEqual([]);
  });

  it('gives the right of access its three parts: the choices, the click ids, the events', async () => {
    const j = await account();
    const granted = ago(2 * DAY);
    await choice(j, granted);
    await click(j, 'FBCLID', 'IwAR0access', ago(DAY));
    const act = await conversion('SIGNUP', j, src.instagram, ago(MIN));
    await pass();
    await ads.choose({ deviceId: null, accountId: j, choice: 'DECLINED', source: 'ACCOUNT', userAgent: UA });
    const data = await accountAdsData(db, j);
    expect(data.choices).toEqual([
      { choice: 'GRANTED', source: 'BANNER', chosenAt: granted, textVersion: ADS_TEXT_VERSION },
      { choice: 'DECLINED', source: 'ACCOUNT', chosenAt: now(), textVersion: ADS_TEXT_VERSION },
    ]);
    // Declined: its click ids erased.
    expect(data.clicks).toEqual([]);
    expect(data.events).toEqual([{ platform: 'META', kind: 'SIGNUP', status: 'CANCELLED', createdAt: now(), sentAt: null, settledAt: now() }]);
    expect(data.retention).toHaveLength(3);
    const k = await account();
    await choice(k, ago(DAY));
    await click(k, 'TTCLID', 'E.C.P.access', ago(DAY));
    expect((await accountAdsData(db, k)).clicks).toEqual([{ kind: 'TTCLID', clickedAt: ago(DAY), clickId: 'E.C.P.access' }]);
    expect(act).toBeGreaterThan(0);
  });

  it('purges events 90 days after they settled, click ids 90 days after the click, a device’s choices after 13 months', async () => {
    const l = await account();
    await choice(l, ago(400 * DAY));
    await click(l, 'GCLID', 'Cj0Kold', ago(91 * DAY));
    await click(l, 'GCLID', 'Cj0Kfresh', ago(89 * DAY));
    const dev = await device();
    await db.insertInto('ad_consents').values({ device_id: dev, choice: 'DECLINED', source: 'BANNER', text_version: ADS_TEXT_VERSION, chosen_at: ago(400 * DAY) }).execute();
    await db.insertInto('ad_consents').values({ device_id: dev, choice: 'DECLINED', source: 'BANNER', text_version: ADS_TEXT_VERSION, chosen_at: ago(300 * DAY) }).execute();
    const act = await conversion('SIGNUP', l, src.press, ago(MIN));
    await db.insertInto('ad_events').values({ platform: 'GOOGLE', conversion_id: act, kind: 'SIGNUP', status: 'SKIPPED', skip_reason: 'NO_CLICK_ID', created_at: ago(95 * DAY), not_before: ago(95 * DAY), settled_at: ago(91 * DAY) }).execute();
    await db.insertInto('ad_events').values({ platform: 'META', conversion_id: act, kind: 'SIGNUP', status: 'SKIPPED', skip_reason: 'TOO_OLD', created_at: ago(95 * DAY), not_before: ago(95 * DAY), settled_at: ago(89 * DAY) }).execute();
    const before = Number((await db.selectFrom('ad_events').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow()).n);
    const erased = await ads.purge(now());
    expect(erased).toBeGreaterThanOrEqual(3);
    expect((await db.selectFrom('ad_clicks').select('click_id').where('account_id', '=', l).execute()).map((c) => c.click_id)).toEqual(['Cj0Kfresh']);
    expect(await db.selectFrom('ad_events').select('platform').where('conversion_id', '=', act).execute()).toEqual([{ platform: 'META' }]);
    expect(Number((await db.selectFrom('ad_events').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow()).n)).toBe(before - 1);
    expect((await db.selectFrom('ad_consents').select('chosen_at').where('device_id', '=', dev).execute()).map((c) => c.chosen_at)).toEqual([ago(300 * DAY)]);
    // The account's choice is kept with the account, however old.
    expect(await db.selectFrom('ad_consents').select('id').where('account_id', '=', l).execute()).toHaveLength(1);
  });

  it('lets a mapped channel be removed with its mapping, and the device purge keep a device holding a choice or a click id', async () => {
    const audit = new AuditService({ db, clock: clock.now });
    const links = new LinkService({ db, audit, publicOrigin: ORIGIN, clock: clock.now });
    const channel = await links.createChannel({ name: 'Podcasts', position: 90 }, actor);
    await ads.setChannelPlatforms(channel.id, ['TIKTOK'], actor);
    await links.deleteChannel(channel.id, actor);
    expect(await db.selectFrom('ads_channel_platforms').select('platform').where('channel_id', '=', channel.id).execute()).toEqual([]);
    // Three devices unseen for 14 months, never linked: one with a choice, one with a click id, one with neither.
    const old = ago(430 * DAY);
    const unseen = async () =>
      Number((await db.insertInto('tracking_devices').values({ device_hash: randomUUID().replace(/-/g, '').padEnd(43, 'u'), first_seen_at: old, last_seen_at: old }).returning('id').executeTakeFirstOrThrow()).id);
    const chose = await unseen();
    const clicked = await unseen();
    const bare = await unseen();
    await db.insertInto('ad_consents').values({ device_id: chose, choice: 'DECLINED', source: 'BANNER', text_version: ADS_TEXT_VERSION, chosen_at: ago(DAY) }).execute();
    await db.insertInto('ad_clicks').values({ device_id: clicked, kind: 'TTCLID', click_id: 'E.C.P.kept', clicked_at: ago(DAY) }).execute();
    const tracking = new TrackingService({ db, places: new PlaceService({ db }), clock: clock.now });
    expect(await tracking.purgeDevices(now())).toBeGreaterThanOrEqual(1);
    const left = (await db.selectFrom('tracking_devices').select('id').where('id', 'in', [chose, clicked, bare]).execute()).map((d) => Number(d.id)).sort((x, y) => x - y);
    expect(left).toEqual([chose, clicked].sort((x, y) => x - y));
    await tracking.stop();
  });

  it('audits the console’s acts, never a key nor an account', async () => {
    const rows = await db.selectFrom('audit_logs').select(['action', 'details', 'target_type']).where('action', 'like', 'ads.%').orderBy('id').execute();
    expect([...new Set(rows.map((r) => r.action))].sort()).toEqual(['ads.channels', 'ads.google_actions', 'ads.switch', 'ads.test', 'ads.test_codes']);
    const text = JSON.stringify(rows);
    for (const secret of [KEYS.meta!.accessToken, KEYS.tiktok!.accessToken, KEYS.google!.refreshToken, KEYS.google!.clientSecret, KEYS.google!.developerToken, 'TEST12345']) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/@example\.com|account/i);
    expect(rows.find((r) => r.action === 'ads.test_codes')?.details).toEqual({ meta: true, tiktok: true });
    // A choice is not audited: its row is the record.
    expect(await db.selectFrom('audit_logs').select('id').where('action', 'like', 'consent%').execute()).toEqual([]);
    expect(await sql`SELECT 1`.execute(db)).toBeTruthy();
  });
});
