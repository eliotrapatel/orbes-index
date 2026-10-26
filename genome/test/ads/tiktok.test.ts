/**
 * TikTok's Events API body and sender (lot M4, K27 §3.2 and §3.6): the body against its fixture byte for byte (the known
 * email's hash, the external id, the ttclid, the paid value), no field beyond §3.1's list, the token in the
 * `Access-Token` header and never in the URL or the body, the test mode, and TikTok's refusals (HTTP 200 with a code)
 * kept without the token.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AD_EVENT_KINDS } from '../../src/server/db/schema.js';
import { AdsHttp, AdsHttpError } from '../../src/server/ads/http.js';
import { TIKTOK_API_VERSION, TIKTOK_BASE_URL, TIKTOK_EVENT_NAMES, TIKTOK_MAX_AGE_DAYS, TikTokSender, tiktokBody, tiktokUrl } from '../../src/server/ads/tiktok.js';
import { FAKE_ADS_PATHS, startFakeAds, type FakeAds } from '../support/fake-ads.js';
import { click, fixture, keyPaths, paidOrder, PERSONAL, pretty, signup } from './fixtures/events.js';

const KEYS = { pixelCode: 'CTESTPIXEL0123', accessToken: 'TIKTOK-TEST-TOKEN-0123456789' };

describe('TikTok: the body (pure)', () => {
  it('a paid order: the fixture byte for byte (hashed email and external id, ttclid, user agent, value)', () => {
    const body = tiktokBody(paidOrder([click('TTCLID', 'E.C.P.fakettclid'), click('FBCLID', 'IwAR0fakeclick')]), { pixelCode: KEYS.pixelCode });
    expect(pretty(body)).toBe(fixture('tiktok-paid-order.json'));
  });

  it('a sign-up in test mode: the fixture byte for byte, the test code beside the pixel', () => {
    expect(pretty(tiktokBody(signup(), { pixelCode: KEYS.pixelCode, testEventCode: 'TEST67890' }))).toBe(fixture('tiktok-signup.json'));
    expect(tiktokBody(signup(), { pixelCode: KEYS.pixelCode, testEventCode: null })).not.toHaveProperty('test_event_code');
  });

  it('holds no field beyond §3.1\'s list (no country: TikTok does not ask it), and nothing in clear', () => {
    const allowed = [
      'event_source', 'event_source_id', 'test_event_code', 'data', 'data[].event', 'data[].event_time', 'data[].event_id', 'data[].user',
      'data[].user.email', 'data[].user.external_id', 'data[].user.ttclid', 'data[].user.user_agent', 'data[].properties', 'data[].properties.value',
      'data[].properties.currency',
    ];
    const body = tiktokBody(paidOrder([click('TTCLID', 'x'), click('GCLID', 'g')]), { pixelCode: KEYS.pixelCode, testEventCode: 'T' });
    expect(keyPaths(body).filter((k) => !allowed.includes(k))).toEqual([]);
    const text = JSON.stringify(body);
    for (const v of Object.values(PERSONAL)) expect(text).not.toContain(v);
    expect(text).not.toContain('"g"');
    expect(text).not.toContain(KEYS.accessToken);
  });

  it('names each act with its standard event, and a value only on a paid order', () => {
    expect(Object.keys(TIKTOK_EVENT_NAMES)).toEqual([...AD_EVENT_KINDS]);
    expect(TIKTOK_EVENT_NAMES).toEqual({ SIGNUP: 'CompleteRegistration', DRAW_ENTRY: 'SubmitForm', LIVE_ENTRY: 'Contact', PAID_ORDER: 'CompletePayment' });
    expect(() => tiktokBody({ ...signup(), value: { minor: 1, currency: 'EUR' } }, { pixelCode: 'P' })).toThrow(/paid order/);
    expect(TIKTOK_MAX_AGE_DAYS).toBe(7);
  });

  it('posts to event/track of the pinned API version, on business-api.tiktok.com', () => {
    expect(TIKTOK_API_VERSION).toMatch(/^v[0-9]+\.[0-9]+$/);
    expect(tiktokUrl(TIKTOK_BASE_URL)).toBe(`https://business-api.tiktok.com/open_api/${TIKTOK_API_VERSION}/event/track/`);
  });
});

describe('TikTok: the sender, against the local fake', () => {
  let ads: FakeAds;
  let sender: TikTokSender;
  beforeAll(async () => {
    ads = await startFakeAds();
    sender = new TikTokSender(KEYS, new AdsHttp({ testOrigins: [ads.origin] }), { baseUrl: ads.origin });
  });
  afterAll(() => ads.close());
  beforeEach(() => ads.reset());

  it('sends the body as built, the token in the Access-Token header only', async () => {
    const event = paidOrder([click('TTCLID', 'E.C.P.fakettclid')]);
    expect(await sender.send(event)).toEqual({ status: 200, answer: 'HTTP 200: {"code":0,"message":"OK","request_id":"FAKE"}' });
    const [req] = ads.requests;
    expect(req!.path).toBe(`/open_api/${TIKTOK_API_VERSION}/event/track/`);
    expect(req!.headers['access-token']).toBe(KEYS.accessToken);
    expect(req!.path).not.toContain(KEYS.accessToken);
    expect(req!.body).not.toContain(KEYS.accessToken);
    expect(req!.json).toEqual(tiktokBody(event, { pixelCode: KEYS.pixelCode }));
  });

  it('the test mode carries the test event code', async () => {
    await sender.send(signup(), { testEventCode: 'TEST67890' });
    expect((ads.requests[0]!.json as { test_event_code?: string }).test_event_code).toBe('TEST67890');
  });

  it('TikTok\'s refusal comes as HTTP 200 with a code: an AdsHttpError, the token removed', async () => {
    ads.answer(FAKE_ADS_PATHS.tiktok, { status: 200, body: { code: 40001, message: `Access token ${KEYS.accessToken} is invalid`, request_id: 'R' } });
    const err = (await sender.send(signup()).catch((e: unknown) => e)) as AdsHttpError;
    expect(err).toBeInstanceOf(AdsHttpError);
    expect(err.status).toBe(200);
    expect(err.detail).toMatch(/^HTTP 200: \{"code":40001,/);
    expect(err.detail).not.toContain(KEYS.accessToken);
  });

  it('an HTTP error is an AdsHttpError with its status', async () => {
    ads.answer(FAKE_ADS_PATHS.tiktok, { status: 503, body: 'upstream down' });
    await expect(sender.send(signup())).rejects.toMatchObject({ status: 503, detail: 'HTTP 503: upstream down' });
  });
});
