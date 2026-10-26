/**
 * Google Ads' click conversion body and sender (lot M4, K27 §3.2 and §3.6): the body against its fixture byte for byte
 * (the conversion action, the gclid with the known email's hash, the paid value), a gbraid or wbraid alone, no Google
 * click id refused, no field beyond §3.1's list, the OAuth access token from the refresh token kept in memory until its
 * expiry, the developer-token and login-customer-id headers, no key in a URL, the test mode (validateOnly), and Google's
 * refusals (HTTP 200 with a partialFailureError) kept without a key.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdsHttp, AdsHttpError } from '../../src/server/ads/http.js';
import {
  GOOGLE_ADS_API_VERSION,
  GOOGLE_ADS_BASE_URL,
  GOOGLE_MAX_AGE_DAYS,
  GOOGLE_OAUTH_BASE_URL,
  GOOGLE_TOKEN_MARGIN_MS,
  GoogleSender,
  googleBody,
  googleClick,
  googleDateTime,
  googleTokenUrl,
  googleUrl,
} from '../../src/server/ads/google.js';
import type { GoogleAdsKeys } from '../../src/server/config.js';
import { FAKE_ADS_PATHS, startFakeAds, type FakeAds } from '../support/fake-ads.js';
import { click, fixture, keyPaths, paidOrder, PERSONAL, pretty, signup } from './fixtures/events.js';

const ACTION = 'customers/1234567890/conversionActions/987654321';
const KEYS: GoogleAdsKeys = {
  customerId: '1234567890',
  loginCustomerId: '1112223333',
  developerToken: 'GOOGLE-DEV-TOKEN-0123456789',
  clientId: 'fake-client.apps.googleusercontent.com',
  clientSecret: 'GOOGLE-CLIENT-SECRET-0123456789',
  refreshToken: 'GOOGLE-REFRESH-TOKEN-0123456789',
};
const ALL_KEYS = [KEYS.developerToken, KEYS.clientSecret, KEYS.refreshToken];

describe('Google: the body (pure)', () => {
  it('a paid order with a gclid: the fixture byte for byte (action, time, gclid, order id, value, hashed email, consent)', () => {
    const body = googleBody(paidOrder([click('GCLID', 'Cj0KfakeGclid'), click('FBCLID', 'IwAR0fakeclick')]), { conversionAction: ACTION, validateOnly: false });
    expect(pretty(body)).toBe(fixture('google-paid-order.json'));
  });

  it('a sign-up with a gbraid, in test mode: the fixture byte for byte, the click alone (no hashed email beside a braid)', () => {
    const body = googleBody(signup([click('GBRAID', '0AAAAAfakeGbraid')]), { conversionAction: 'customers/1234567890/conversionActions/111', validateOnly: true });
    expect(pretty(body)).toBe(fixture('google-signup-gbraid.json'));
  });

  it('takes the latest Google click id, one only; without any, refuses (the service skips it: NO_CLICK_ID)', () => {
    const event = signup([click('GCLID', 'old', '2026-10-01T00:00:00Z'), click('WBRAID', 'newest', '2026-10-03T00:00:00Z'), click('GBRAID', 'mid', '2026-10-02T00:00:00Z')]);
    expect(googleClick(event)).toEqual(click('WBRAID', 'newest', '2026-10-03T00:00:00Z'));
    const c = googleBody(event, { conversionAction: ACTION, validateOnly: false }).conversions[0];
    expect([c.gclid, c.gbraid, c.wbraid]).toEqual([undefined, undefined, 'newest']);
    expect(googleClick(signup([click('FBCLID', 'f'), click('TTCLID', 't')]))).toBeNull();
    expect(() => googleBody(signup([click('FBCLID', 'f')]), { conversionAction: ACTION, validateOnly: false })).toThrow(/Google click id/);
  });

  it('refuses a conversion action that is not a resource name', () => {
    expect(() => googleBody(paidOrder([click('GCLID', 'g')]), { conversionAction: 'Purchase', validateOnly: false })).toThrow(/conversion action/);
  });

  it('holds no field beyond §3.1\'s list, and nothing in clear', () => {
    const allowed = [
      'conversions', 'conversions[].conversionAction', 'conversions[].conversionDateTime', 'conversions[].gclid', 'conversions[].gbraid', 'conversions[].wbraid',
      'conversions[].orderId', 'conversions[].conversionValue', 'conversions[].currencyCode', 'conversions[].userIdentifiers', 'conversions[].userIdentifiers[].hashedEmail',
      'conversions[].consent', 'conversions[].consent.adUserData', 'partialFailure', 'validateOnly',
    ];
    const body = googleBody(paidOrder([click('GCLID', 'g')]), { conversionAction: ACTION, validateOnly: false });
    expect(keyPaths(body).filter((k) => !allowed.includes(k))).toEqual([]);
    const text = JSON.stringify(body);
    for (const v of Object.values(PERSONAL)) expect(text).not.toContain(v);
    expect(text).not.toMatch(/"FR"|Mozilla/);
  });

  it('writes the time as Google takes it, pins its API version and its hosts', () => {
    expect(googleDateTime(new Date('2026-10-26T08:30:00.999Z'))).toBe('2026-10-26 08:30:00+00:00');
    expect(GOOGLE_ADS_API_VERSION).toMatch(/^v[0-9]+$/);
    expect(googleUrl(GOOGLE_ADS_BASE_URL, KEYS.customerId)).toBe(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/1234567890:uploadClickConversions`);
    expect(googleTokenUrl(GOOGLE_OAUTH_BASE_URL)).toBe('https://oauth2.googleapis.com/token');
    expect(GOOGLE_MAX_AGE_DAYS).toBe(90);
  });
});

describe('Google: the sender, against the local fake', () => {
  let ads: FakeAds;
  let now = 0;
  const sender = (keys: GoogleAdsKeys = KEYS): GoogleSender => new GoogleSender(keys, new AdsHttp({ testOrigins: [ads.origin] }), { baseUrl: ads.origin, oauthBaseUrl: ads.origin, now: () => now });
  beforeAll(async () => {
    ads = await startFakeAds();
  });
  afterAll(() => ads.close());
  beforeEach(() => {
    ads.reset();
    now = Date.parse('2026-10-26T08:30:00Z');
  });

  it('asks an access token from the refresh token (a form), then uploads with it, the developer token and the login customer', async () => {
    const event = paidOrder([click('GCLID', 'Cj0KfakeGclid')]);
    const result = await sender().send(event, { conversionAction: ACTION });
    expect(result.status).toBe(200);
    expect(result.answer).toMatch(/^HTTP 200: \{"results":/);
    expect(ads.requests.map((r) => r.path)).toEqual(['/token', `/${GOOGLE_ADS_API_VERSION}/customers/1234567890:uploadClickConversions`]);
    const [token, upload] = ads.requests;
    expect(token!.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(token!.body))).toEqual({ grant_type: 'refresh_token', client_id: KEYS.clientId, client_secret: KEYS.clientSecret, refresh_token: KEYS.refreshToken });
    expect(upload!.headers.authorization).toMatch(/^Bearer fake-access-token-\d+$/);
    expect(upload!.headers['developer-token']).toBe(KEYS.developerToken);
    expect(upload!.headers['login-customer-id']).toBe(KEYS.loginCustomerId);
    expect(upload!.json).toEqual(googleBody(event, { conversionAction: ACTION, validateOnly: false }));
    // No key in any URL, and none in the upload's body.
    for (const r of ads.requests) for (const k of [...ALL_KEYS, upload!.headers.authorization!.slice(7)]) expect(r.path).not.toContain(k);
    for (const k of ALL_KEYS) expect(upload!.body).not.toContain(k);
  });

  it('keeps the access token in memory until shortly before it expires, then asks a new one', async () => {
    const s = sender();
    const event = paidOrder([click('GCLID', 'g')]);
    await s.send(event, { conversionAction: ACTION });
    now += 3_599_000 - GOOGLE_TOKEN_MARGIN_MS - 1;
    await s.send(event, { conversionAction: ACTION });
    expect(ads.requests.filter((r) => r.path === '/token')).toHaveLength(1);
    now += 2;
    await s.send(event, { conversionAction: ACTION });
    expect(ads.requests.filter((r) => r.path === '/token')).toHaveLength(2);
    const auth = ads.requests.filter((r) => r.path !== '/token').map((r) => r.headers.authorization);
    expect(auth[0]).toBe(auth[1]);
    expect(auth[2]).not.toBe(auth[1]);
  });

  it('without a manager account, sends no login-customer-id', async () => {
    await sender({ ...KEYS, loginCustomerId: null }).send(paidOrder([click('GCLID', 'g')]), { conversionAction: ACTION });
    expect(ads.requests[1]!.headers).not.toHaveProperty('login-customer-id');
  });

  it('the test mode is validateOnly', async () => {
    const result = await sender().send(signup([click('GCLID', 'g')]), { conversionAction: ACTION, validateOnly: true });
    expect((ads.requests[1]!.json as { validateOnly: boolean }).validateOnly).toBe(true);
    expect(result.answer).toBe('HTTP 200: {}');
  });

  it('Google\'s refusal comes as HTTP 200 with a partialFailureError: an AdsHttpError', async () => {
    ads.answer(FAKE_ADS_PATHS.google, { status: 200, body: { partialFailureError: { code: 3, message: 'The click was not found.' }, results: [{}] } });
    const err = (await sender().send(paidOrder([click('GCLID', 'g')]), { conversionAction: ACTION }).catch((e: unknown) => e)) as AdsHttpError;
    expect(err).toBeInstanceOf(AdsHttpError);
    expect(err.detail).toMatch(/^HTTP 200: \{"partialFailureError":\{"code":3,/);
  });

  it('a 401 drops the access token, so the next attempt asks a new one; no key in the error', async () => {
    const s = sender();
    await s.send(paidOrder([click('GCLID', 'g')]), { conversionAction: ACTION });
    const token = ads.requests[1]!.headers.authorization!.slice('Bearer '.length);
    ads.answer(FAKE_ADS_PATHS.google, { status: 401, body: { error: { code: 401, message: `Request had invalid authentication credentials: ${token}`, status: 'UNAUTHENTICATED' } } });
    const err = (await s.send(paidOrder([click('GCLID', 'g')]), { conversionAction: ACTION }).catch((e: unknown) => e)) as AdsHttpError;
    expect(err.status).toBe(401);
    expect(err.detail).not.toContain(token);
    await s.send(paidOrder([click('GCLID', 'g')]), { conversionAction: ACTION });
    expect(ads.requests.filter((r) => r.path === '/token')).toHaveLength(2);
  });

  it('an OAuth refusal is an AdsHttpError without the secret or the refresh token', async () => {
    ads.answer(FAKE_ADS_PATHS.oauth, { status: 400, body: { error: 'invalid_grant', error_description: `Bad refresh_token=${KEYS.refreshToken} for client_secret ${KEYS.clientSecret}` } });
    const err = (await sender().send(paidOrder([click('GCLID', 'g')]), { conversionAction: ACTION }).catch((e: unknown) => e)) as AdsHttpError;
    expect(err).toBeInstanceOf(AdsHttpError);
    expect(err.status).toBe(400);
    expect(err.detail).toContain('invalid_grant');
    for (const k of ALL_KEYS) expect(err.detail).not.toContain(k);
    expect(ads.requests.map((r) => r.path)).toEqual(['/token']);
  });

  it('an OAuth answer without an access token is a refusal, and nothing is uploaded', async () => {
    ads.answer(FAKE_ADS_PATHS.oauth, { status: 200, body: { token_type: 'Bearer' } });
    await expect(sender().send(paidOrder([click('GCLID', 'g')]), { conversionAction: ACTION })).rejects.toThrow(/no access token/);
    expect(ads.requests.map((r) => r.path)).toEqual(['/token']);
  });
});
