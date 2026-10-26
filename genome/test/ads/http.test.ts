/**
 * The advertising client (lot M4, K27 §3.2 and §3.6): a host outside ADS_HOSTS refused before any request, `http:`
 * refused outside the tests' injected base (a loopback origin only), redirects refused, the body capped at 8 KiB, the
 * answer's tokens scrubbed from an error, the time limit.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AD_EVENT_ERROR_MAX } from '../../src/server/db/schema.js';
import { ADS_HOSTS, ADS_RESPONSE_MAX_BYTES, ADS_TIMEOUT_MS, AdsHttp, AdsHttpError, adsErrorDetail, scrubAdsText } from '../../src/server/ads/http.js';
import { startFakeAds, type FakeAds } from '../support/fake-ads.js';

let ads: FakeAds;
beforeAll(async () => {
  ads = await startFakeAds();
});
afterAll(() => ads.close());
beforeEach(() => ads.reset());
afterEach(() => vi.restoreAllMocks());

describe('the hosts', () => {
  it('ADS_HOSTS is a fixed, frozen list of the four platforms\' hosts', () => {
    expect(ADS_HOSTS).toEqual(['graph.facebook.com', 'business-api.tiktok.com', 'googleads.googleapis.com', 'oauth2.googleapis.com']);
    expect(Object.isFrozen(ADS_HOSTS)).toBe(true);
    expect(ADS_TIMEOUT_MS).toBe(10_000);
    expect(ADS_RESPONSE_MAX_BYTES).toBe(8_192);
  });

  it('allows https to those hosts only, on their own port, without credentials', () => {
    const http = new AdsHttp();
    for (const host of ADS_HOSTS) expect(http.allows(`https://${host}/x`), host).toBe(true);
    for (const url of [
      'http://graph.facebook.com/v24.0/1/events',
      'https://graph.facebook.com:8443/v24.0/1/events',
      'https://user:pw@graph.facebook.com/v24.0/1/events',
      'https://graph.facebook.com.evil.example/x',
      'https://evil.example/graph.facebook.com',
      'https://facebook.com/x',
      'https://www.googleapis.com/x',
      'https://example.myshopify.com/admin/api',
      'ftp://graph.facebook.com/x',
      'not a url',
      `${ads.origin}/token`,
    ]) {
      expect(http.allows(url), url).toBe(false);
    }
  });

  it('refuses a host outside ADS_HOSTS before any request is made', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const http = new AdsHttp();
    for (const url of ['https://evil.example/events', 'http://graph.facebook.com/v24.0/1/events', `${ads.origin}/token`]) {
      const err = (await http.postJson(url, { a: 1 }).catch((e: unknown) => e)) as AdsHttpError;
      expect(err, url).toBeInstanceOf(AdsHttpError);
      expect(err.refused, url).toBe(true);
      expect(err.status, url).toBeNull();
      expect(err.detail, url).toMatch(/^NO ANSWER: refused: .* is not an ad platform's host$/);
    }
    expect(spy).not.toHaveBeenCalled();
    expect(ads.requests).toEqual([]);
  });

  it('takes a test origin only when it is a loopback http origin', () => {
    for (const o of ['https://127.0.0.1:1234', 'http://10.0.0.1:1234', 'http://example.com', 'http://127.0.0.1:1234/path', 'http://u:p@127.0.0.1:1', 'nonsense']) {
      expect(() => new AdsHttp({ testOrigins: [o] }), o).toThrow(/ads:/);
    }
    const http = new AdsHttp({ testOrigins: [ads.origin, 'http://localhost:9', 'http://[::1]:9'] });
    expect(http.allows(`${ads.origin}/token`)).toBe(true);
    // Another local port is not the listed one.
    expect(http.allows(`http://127.0.0.1:${Number(new URL(ads.origin).port) + 1}/token`)).toBe(false);
  });
});

describe('a request to the listed origin', () => {
  const http = (): AdsHttp => new AdsHttp({ testOrigins: [ads.origin] });

  it('posts JSON and reads the JSON answer', async () => {
    ads.answer(/^\/echo$/, { status: 201, body: { ok: true } });
    const res = await http().postJson(`${ads.origin}/echo`, { a: 'b' }, { 'x-one': '1' });
    expect(res).toEqual({ status: 201, text: '{"ok":true}', json: { ok: true }, truncated: false });
    expect(ads.requests[0]).toMatchObject({ method: 'POST', path: '/echo', body: '{"a":"b"}' });
    expect(ads.requests[0]!.headers).toMatchObject({ 'content-type': 'application/json', accept: 'application/json', 'x-one': '1' });
  });

  it('posts a form', async () => {
    ads.answer(/^\/form$/, { status: 200, body: {} });
    await http().postForm(`${ads.origin}/form`, { a: 'b c', d: '&' });
    expect(ads.requests[0]).toMatchObject({ body: 'a=b+c&d=%26' });
    expect(ads.requests[0]!.headers['content-type']).toBe('application/x-www-form-urlencoded');
  });

  it('refuses a redirect, and never follows it', async () => {
    ads.answer(/^\/moved$/, { status: 302, headers: { location: `${ads.origin}/elsewhere` }, body: '' });
    const err = (await http().postJson(`${ads.origin}/moved`, {}).catch((e: unknown) => e)) as AdsHttpError;
    expect(err).toBeInstanceOf(AdsHttpError);
    expect(err.status).toBeNull();
    expect(err.detail).toMatch(/^NO ANSWER: .*redirect/i);
    expect(ads.requests.map((r) => r.path)).toEqual(['/moved']);
  });

  it('reads 8 KiB of an answer at most', async () => {
    ads.answer(/^\/big$/, { status: 200, bytes: 100_000 });
    const res = await http().postJson(`${ads.origin}/big`, {});
    expect(res.truncated).toBe(true);
    expect(res.text).toBe('x'.repeat(ADS_RESPONSE_MAX_BYTES));
    expect(res.json).toBeNull();
    ads.answer(/^\/exact$/, { status: 200, bytes: ADS_RESPONSE_MAX_BYTES });
    expect(await http().postJson(`${ads.origin}/exact`, {})).toMatchObject({ truncated: false, text: 'x'.repeat(ADS_RESPONSE_MAX_BYTES) });
  });

  it('an error keeps the status and 300 characters of the answer at most, every token removed', async () => {
    const secret = 'S3CR3T-token-value-0123456789';
    ads.answer(/^\/refused$/, {
      status: 400,
      body: `{"error":"bad","access_token":"leaked-1","echo":"${secret}","url":"https://x/?access_token=leaked-2&refresh_token=leaked-3","auth":"Bearer leaked-4"}\n${'y'.repeat(1_000)}`,
    });
    const err = (await http().postJson(`${ads.origin}/refused`, {}, {}, { secrets: [secret] }).catch((e: unknown) => e)) as AdsHttpError;
    expect(err.status).toBe(400);
    expect([...err.detail].length).toBe(AD_EVENT_ERROR_MAX);
    expect(err.detail).toMatch(/^HTTP 400: \{"error":"bad","access_token":"\[removed\]","echo":"\[removed\]"/);
    expect(err.detail).toContain('access_token=[removed]&refresh_token=[removed]');
    expect(err.detail).toContain('Bearer [removed]');
    expect(err.detail).not.toMatch(/leaked|S3CR3T|\n/);
    expect(err.message).toBe(err.detail);
  });

  it('gives up after its time limit', async () => {
    ads.answer(/^\/slow$/, { status: 200, body: {}, delayMs: 1_000 });
    const err = (await http().postJson(`${ads.origin}/slow`, {}, {}, { timeoutMs: 100 }).catch((e: unknown) => e)) as AdsHttpError;
    expect(err).toBeInstanceOf(AdsHttpError);
    expect(err.detail).toBe('NO ANSWER: timed out');
  });

  it('a closed port is NO ANSWER', async () => {
    const closed = await startFakeAds();
    const origin = closed.origin;
    await closed.close();
    const err = (await new AdsHttp({ testOrigins: [origin] }).postJson(`${origin}/x`, {}).catch((e: unknown) => e)) as AdsHttpError;
    expect(err.status).toBeNull();
    expect(err.detail).toMatch(/^NO ANSWER: /);
  });
});

describe('scrubAdsText and adsErrorDetail', () => {
  it('remove the listed secrets and every token-shaped value, on one line', () => {
    expect(scrubAdsText('a\tb\r\n  c "token": "abc" client_secret=xyz developer-token: dev1 id_token=i', ['b'])).toBe('a [removed] c "token": "[removed]" client_secret=[removed] developer-token: [removed] id_token=[removed]');
    expect(scrubAdsText('"token_type":"Bearer","expires_in":3599')).toBe('"token_type":"Bearer","expires_in":3599');
    expect(adsErrorDetail(null, '')).toBe('NO ANSWER');
    expect(adsErrorDetail(500, 'é'.repeat(400))).toHaveLength(AD_EVENT_ERROR_MAX);
  });
});
