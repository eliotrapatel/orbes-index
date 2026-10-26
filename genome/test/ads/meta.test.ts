/**
 * Meta's Conversions API body and sender (lot M4, K27 §3.2 and §3.6): the body against its fixture byte for byte (the
 * known email's hash, the external id, `fbc` from `fbclid` and its time, the paid value), no field beyond §3.1's list,
 * the token in the POST body and never in the URL, the test mode, and Meta's refusals kept without the token.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AD_EVENT_KINDS } from '../../src/server/db/schema.js';
import { AdsHttp, AdsHttpError } from '../../src/server/ads/http.js';
import { META_BASE_URL, META_EVENT_NAMES, META_GRAPH_VERSION, META_MAX_AGE_DAYS, MetaSender, metaBody, metaFbc, metaUrl } from '../../src/server/ads/meta.js';
import { FAKE_ADS_PATHS, startFakeAds, type FakeAds } from '../support/fake-ads.js';
import { click, fixture, keyPaths, paidOrder, PERSONAL, pretty, signup, SOURCE_URL, USER_AGENT } from './fixtures/events.js';

const KEYS = { datasetId: '123456789012345', accessToken: 'META-TEST-TOKEN-0123456789' };

describe('Meta: the body (pure)', () => {
  it('a paid order: the fixture byte for byte (hashed email, external id and country, fbc from the fbclid and its time, value)', () => {
    const body = metaBody(paidOrder([click('FBCLID', 'IwAR0fakeclick'), click('GCLID', 'Cj0KfakeGclid')]), { accessToken: KEYS.accessToken, sourceUrl: SOURCE_URL });
    expect(pretty(body)).toBe(fixture('meta-paid-order.json'));
    expect(metaFbc('IwAR0fakeclick', new Date('2026-10-20T09:15:00.123Z'))).toBe('fb.1.1792487700123.IwAR0fakeclick');
  });

  it('a sign-up in test mode: the fixture byte for byte, with only what every event carries and the test code', () => {
    expect(pretty(metaBody(signup(), { accessToken: KEYS.accessToken, sourceUrl: SOURCE_URL, testEventCode: 'TEST12345' }))).toBe(fixture('meta-signup.json'));
    expect(metaBody(signup(), { accessToken: KEYS.accessToken, sourceUrl: SOURCE_URL, testEventCode: null })).not.toHaveProperty('test_event_code');
  });

  it('the latest fbclid gives fbc; another platform\'s click id is never sent', () => {
    const body = metaBody(paidOrder([click('FBCLID', 'older', '2026-10-01T00:00:00Z'), click('FBCLID', 'newer', '2026-10-02T00:00:00Z'), click('TTCLID', 'tt')]), { accessToken: 't', sourceUrl: SOURCE_URL });
    expect(body.data[0].user_data.fbc).toBe(`fb.1.${Date.parse('2026-10-02T00:00:00Z')}.newer`);
    expect(JSON.stringify(body)).not.toContain('"tt"');
  });

  it('holds no field beyond §3.1\'s list, and no name, email, account id or piece in clear', () => {
    const allowed = [
      'data', 'data[].event_name', 'data[].event_time', 'data[].event_id', 'data[].action_source', 'data[].event_source_url', 'data[].user_data',
      'data[].user_data.em', 'data[].user_data.external_id', 'data[].user_data.country', 'data[].user_data.fbc', 'data[].user_data.client_user_agent',
      'data[].custom_data', 'data[].custom_data.value', 'data[].custom_data.currency', 'access_token', 'test_event_code',
    ];
    const body = metaBody(paidOrder([click('FBCLID', 'IwAR0fakeclick')]), { accessToken: 't', sourceUrl: SOURCE_URL, testEventCode: 'T' });
    expect(keyPaths(body).filter((k) => !allowed.includes(k))).toEqual([]);
    const text = JSON.stringify(body);
    for (const v of Object.values(PERSONAL)) expect(text).not.toContain(v);
    expect(text).not.toMatch(/"FR"|"fr"/);
  });

  it('names each act with its standard event, and a value only on a paid order', () => {
    expect(Object.keys(META_EVENT_NAMES)).toEqual([...AD_EVENT_KINDS]);
    expect(META_EVENT_NAMES).toEqual({ SIGNUP: 'CompleteRegistration', DRAW_ENTRY: 'SubmitApplication', LIVE_ENTRY: 'Lead', PAID_ORDER: 'Purchase' });
    expect(() => metaBody({ ...signup(), value: { minor: 100, currency: 'EUR' } }, { accessToken: 't', sourceUrl: SOURCE_URL })).toThrow(/paid order/);
    expect(() => metaBody({ ...paidOrder([]), value: null }, { accessToken: 't', sourceUrl: SOURCE_URL })).toThrow(/paid order/);
    expect(META_MAX_AGE_DAYS).toBe(7);
  });

  it('posts to the dataset\'s events edge of the pinned Graph version, on graph.facebook.com', () => {
    expect(META_GRAPH_VERSION).toMatch(/^v[0-9]+\.0$/);
    expect(metaUrl(META_BASE_URL, KEYS.datasetId)).toBe(`https://graph.facebook.com/${META_GRAPH_VERSION}/123456789012345/events`);
  });
});

describe('Meta: the sender, against the local fake', () => {
  let ads: FakeAds;
  let sender: MetaSender;
  beforeAll(async () => {
    ads = await startFakeAds();
    sender = new MetaSender(KEYS, new AdsHttp({ testOrigins: [ads.origin] }), { baseUrl: ads.origin, sourceUrl: SOURCE_URL });
  });
  afterAll(() => ads.close());
  beforeEach(() => ads.reset());

  it('sends the body as built, the token in the POST body and never in the URL or a header', async () => {
    const event = paidOrder([click('FBCLID', 'IwAR0fakeclick')]);
    const result = await sender.send(event);
    expect(result).toEqual({ status: 200, answer: 'HTTP 200: {"events_received":1,"messages":[],"fbtrace_id":"FAKE"}' });
    expect(ads.requests).toHaveLength(1);
    const [req] = ads.requests;
    expect(req!.method).toBe('POST');
    expect(req!.path).toMatch(FAKE_ADS_PATHS.meta);
    expect(req!.path).toBe(`/${META_GRAPH_VERSION}/${KEYS.datasetId}/events`);
    expect(req!.path).not.toContain(KEYS.accessToken);
    expect(JSON.stringify(req!.headers)).not.toContain(KEYS.accessToken);
    expect(req!.headers['content-type']).toBe('application/json');
    expect(req!.json).toEqual(metaBody(event, { accessToken: KEYS.accessToken, sourceUrl: SOURCE_URL }));
    expect((req!.json as { data: [{ user_data: { client_user_agent: string } }] }).data[0].user_data.client_user_agent).toBe(USER_AGENT);
  });

  it('the test mode carries the test event code', async () => {
    await sender.send(signup(), { testEventCode: 'TEST12345' });
    expect((ads.requests[0]!.json as { test_event_code?: string }).test_event_code).toBe('TEST12345');
  });

  it('a refusal is an AdsHttpError with Meta\'s status and answer, the token removed', async () => {
    ads.answer(FAKE_ADS_PATHS.meta, { status: 400, body: { error: { message: `Invalid OAuth access token - Cannot parse access token: ${KEYS.accessToken}`, type: 'OAuthException', code: 190 } } });
    const err = await sender.send(signup()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdsHttpError);
    expect((err as AdsHttpError).status).toBe(400);
    expect((err as AdsHttpError).detail).toMatch(/^HTTP 400: \{"error":\{"message":"Invalid OAuth access token/);
    expect((err as AdsHttpError).detail).not.toContain(KEYS.accessToken);
  });

  it('a 2xx answer that does not count the event received is a refusal', async () => {
    ads.answer(FAKE_ADS_PATHS.meta, { status: 200, body: { events_received: 0 } });
    await expect(sender.send(signup())).rejects.toThrow(/^HTTP 200: \{"events_received":0\}$/);
  });
});
