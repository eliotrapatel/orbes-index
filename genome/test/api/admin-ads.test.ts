/**
 * Links → Ad platforms' routes (lot M4 plan §3.2, §3.5, §3.6, step M4.11; routes/admin/ads.ts), against the local fake
 * platforms:
 *
 *  - GET /api/admin/ads (AUDITOR): the switch, each platform's readiness (true or false, never a key), API version,
 *    last send and last error, the counts by status, its test code; the channels and their platforms; the Google
 *    actions; the choices of this Paris month; no key anywhere in the answer;
 *  - PUT /api/admin/ads/switch (ADMIN): the typed phrase, 409 ADS_NO_PLATFORM with no platform's keys, on and off;
 *  - PUT channels/:channelId (404 CHANNEL_NOT_FOUND), google-actions (the resource name's pattern), test-codes;
 *  - POST test/:platform: 409 ADS_OFF while off, ADS_NO_PLATFORM without its keys, then its answer while on;
 *  - GET events?status=&platform=: kind, platform, status, times, error; no account, no email; a filter it does not
 *    know refused (400);
 *  - an AUDITOR reads and changes nothing (403), an OPERATOR neither (the roles' full matrix is admin-roles.test.ts's).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdsConfig } from '../../src/server/config.js';
import { startFakeAds, type FakeAds } from '../support/fake-ads.js';
import { adminClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

const KEYS: AdsConfig = {
  meta: { datasetId: '123456789012345', accessToken: 'META-SECRET-TOKEN-0123456789' },
  tiktok: null,
  google: { customerId: '1234567890', loginCustomerId: '9876543210', developerToken: 'GOOGLE-DEV-TOKEN-0123', clientId: 'client-id.apps', clientSecret: 'GOOGLE-CLIENT-SECRET-0123', refreshToken: 'GOOGLE-REFRESH-TOKEN-0123' },
};
/** What the server's .env holds (the customer id aside: the owner's own conversion actions name it). */
const SECRETS = [KEYS.meta!.accessToken, KEYS.meta!.datasetId, KEYS.google!.developerToken, KEYS.google!.clientId, KEYS.google!.clientSecret, KEYS.google!.refreshToken, KEYS.google!.loginCustomerId!];

type View = {
  on: boolean;
  eventsFrom: string | null;
  switchedAt: string | null;
  switchedBy: { id: string; email: string } | null;
  phrases: { on: string; off: string };
  platforms: { platform: string; ready: boolean; apiVersion: string; lastSentAt: string | null; lastError: unknown; counts: Record<string, number>; testCode: string | null }[];
  channels: { id: string; name: string; platforms: string[] }[];
  googleActions: Record<string, string | null>;
  consent: { month: string; granted: number; declined: number };
};

describe('Links → Ad platforms (/api/admin/ads*)', () => {
  let h: Harness;
  let fake: FakeAds;
  let admin: Client;
  let operator: Client;
  let auditor: Client;

  beforeAll(async () => {
    fake = await startFakeAds();
    h = await createHarness({ config: { ads: KEYS }, context: { adsTestOrigin: fake.origin } });
    h.clock.set('2026-11-12T10:00:00.000Z');
    admin = await adminClient(h, 'ADMIN');
    operator = await adminClient(h, 'OPERATOR');
    auditor = await adminClient(h, 'AUDITOR');
  });
  afterAll(async () => {
    await h?.close();
    await fake?.close();
  });

  const put = (c: Client, url: string, body: unknown) => c.request('PUT', url, { body });
  const view = async (c: Client = auditor): Promise<View> => {
    const res = await c.get('/api/admin/ads');
    expect(res.statusCode).toBe(200);
    for (const secret of SECRETS) expect(res.body).not.toContain(secret);
    return safeJson(res) as View;
  };

  it('GET /api/admin/ads: off, each platform’s readiness (never a key), its version, the channels, the actions, the month’s choices', async () => {
    const v = await view();
    expect(v).toMatchObject({ on: false, eventsFrom: null, switchedAt: null, switchedBy: null, phrases: { on: 'SWITCH ON', off: 'SWITCH OFF' } });
    expect(v.platforms).toEqual([
      { platform: 'META', ready: true, apiVersion: 'v24.0', lastSentAt: null, lastError: null, counts: { QUEUED: 0, SENT: 0, FAILED: 0, SKIPPED: 0, CANCELLED: 0 }, testCode: null },
      { platform: 'TIKTOK', ready: false, apiVersion: 'v1.3', lastSentAt: null, lastError: null, counts: { QUEUED: 0, SENT: 0, FAILED: 0, SKIPPED: 0, CANCELLED: 0 }, testCode: null },
      { platform: 'GOOGLE', ready: true, apiVersion: 'v22', lastSentAt: null, lastError: null, counts: { QUEUED: 0, SENT: 0, FAILED: 0, SKIPPED: 0, CANCELLED: 0 }, testCode: null },
    ]);
    expect(v.channels.map((c) => [c.name, c.platforms])).toEqual([
      ['Instagram', []],
      ['TikTok', []],
      ['Influencers', []],
      ['Press', []],
      ['Shops', []],
      ['Search', []],
      ['Other', []],
    ]);
    expect(v.googleActions).toEqual({ SIGNUP: null, DRAW_ENTRY: null, LIVE_ENTRY: null, PAID_ORDER: null });
    expect(v.consent).toEqual({ month: '2026-11', granted: 0, declined: 0 });
    // No row written by a read: off is the absence of the switch's row.
    expect(await h.ctx.db.selectFrom('ads_settings').select('id').execute()).toEqual([]);
  });

  it('PUT /api/admin/ads/switch: the typed phrase, 409 ADS_NO_PLATFORM without any platform’s keys, on and off by an ADMIN only', async () => {
    const bare = await createHarness();
    try {
      const res = await put(await adminClient(bare, 'ADMIN'), '/api/admin/ads/switch', { on: true, phrase: 'SWITCH ON' });
      expect([res.statusCode, errorOf(res).code]).toEqual([409, 'ADS_NO_PLATFORM']);
      expect(errorOf(res).message).toBe('No platform has its keys in the server’s .env: conversions cannot be switched on.');
      expect((safeJson(await (await adminClient(bare, 'AUDITOR')).get('/api/admin/ads')) as View).platforms.map((p) => p.ready)).toEqual([false, false, false]);
    } finally {
      await bare.close();
    }
    for (const c of [operator, auditor]) expect((await put(c, '/api/admin/ads/switch', { on: true, phrase: 'SWITCH ON' })).statusCode).toBe(403);
    const wrong = await put(admin, '/api/admin/ads/switch', { on: true, phrase: 'ON' });
    expect([wrong.statusCode, errorOf(wrong).message]).toEqual([400, 'Type SWITCH ON to confirm.']);
    expect((await put(admin, '/api/admin/ads/switch', { on: 'yes', phrase: 'SWITCH ON' })).statusCode).toBe(400);
    const on = await put(admin, '/api/admin/ads/switch', { on: true, phrase: 'SWITCH ON' });
    expect(on.statusCode).toBe(200);
    expect(safeJson(on)).toMatchObject({ on: true, eventsFrom: '2026-11-12T10:00:00.000Z', switchedAt: '2026-11-12T10:00:00.000Z', switchedBy: { email: expect.stringContaining('@') } });
    // The public state follows the switch.
    expect(safeJson(await h.client().get('/api/v1/consent'))).toMatchObject({ ads: { on: true, choice: null } });
  });

  it('PUT channels, Google actions and test codes: an ADMIN’s, each validated, read back', async () => {
    const instagram = (await view()).channels.find((c) => c.name === 'Instagram')!.id;
    expect((await put(operator, `/api/admin/ads/channels/${instagram}`, { platforms: ['META'] })).statusCode).toBe(403);
    expect((await put(admin, `/api/admin/ads/channels/${instagram}`, { platforms: ['SNAPCHAT'] })).statusCode).toBe(400);
    const unknown = await put(admin, '/api/admin/ads/channels/00000000-0000-4000-8000-000000000000', { platforms: ['META'] });
    expect([unknown.statusCode, errorOf(unknown).code]).toEqual([404, 'CHANNEL_NOT_FOUND']);
    const mapped = await put(admin, `/api/admin/ads/channels/${instagram}`, { platforms: ['GOOGLE', 'META'] });
    expect((safeJson(mapped) as View).channels.find((c) => c.id === instagram)!.platforms).toEqual(['META', 'GOOGLE']);

    expect((await put(admin, '/api/admin/ads/google-actions', { signup: 'conversionActions/1' })).statusCode).toBe(400);
    expect((await put(admin, '/api/admin/ads/google-actions', {})).statusCode).toBe(400);
    const actions = await put(admin, '/api/admin/ads/google-actions', { signup: 'customers/1234567890/conversionActions/111', paidOrder: 'customers/1234567890/conversionActions/444' });
    expect((safeJson(actions) as View).googleActions).toEqual({ SIGNUP: 'customers/1234567890/conversionActions/111', DRAW_ENTRY: null, LIVE_ENTRY: null, PAID_ORDER: 'customers/1234567890/conversionActions/444' });
    const cleared = await put(admin, '/api/admin/ads/google-actions', { paidOrder: '' });
    expect((safeJson(cleared) as View).googleActions.PAID_ORDER).toBeNull();

    expect((await put(admin, '/api/admin/ads/test-codes', { meta: 'x'.repeat(41) })).statusCode).toBe(400);
    const codes = await put(admin, '/api/admin/ads/test-codes', { meta: 'TEST12345' });
    expect((safeJson(codes) as View).platforms.map((p) => p.testCode)).toEqual(['TEST12345', null, null]);
  });

  it('POST /api/admin/ads/test/:platform: ADS_NO_PLATFORM without its keys, its answer while on, ADS_OFF while off', async () => {
    expect((await admin.post('/api/admin/ads/test/SNAPCHAT')).statusCode).toBe(400);
    const tiktok = await admin.post('/api/admin/ads/test/tiktok');
    expect([tiktok.statusCode, errorOf(tiktok).code]).toEqual([409, 'ADS_NO_PLATFORM']);
    fake.reset();
    const meta = await admin.post('/api/admin/ads/test/meta');
    expect(meta.statusCode).toBe(200);
    expect(safeJson(meta)).toMatchObject({ platform: 'META', ok: true, status: 200, answer: expect.stringMatching(/^HTTP 200: /) });
    expect((fake.requests[0]!.json as { test_event_code: string }).test_event_code).toBe('TEST12345');
    fake.answer(/./, { status: 401, body: { error: { message: `bad token ${KEYS.meta!.accessToken}` } } });
    const refused = await admin.post('/api/admin/ads/test/META');
    expect(safeJson(refused)).toMatchObject({ platform: 'META', ok: false, status: 401 });
    expect(refused.body).not.toContain(KEYS.meta!.accessToken);
    expect((await operator.post('/api/admin/ads/test/META')).statusCode).toBe(403);
  });

  it('GET /api/admin/ads/events: kind, platform, status, times, error; no account, no email; filtered', async () => {
    expect((await auditor.get('/api/admin/ads/events?status=LOST')).statusCode).toBe(400);
    expect((await auditor.get('/api/admin/ads/events?platform=snap')).statusCode).toBe(400);
    // An event as the sender leaves it.
    const email = 'events-ads@example.com';
    const account = (await h.ctx.db.insertInto('accounts').values({ email, email_normalized: email, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
    const source = (await h.ctx.db.selectFrom('acquisition_sources').select('id').where('key', '=', 'DIRECT').executeTakeFirstOrThrow()).id;
    const conversion = await h.ctx.db.insertInto('acquisition_conversions').values({ kind: 'SIGNUP', ref_id: account, account_id: account, at: h.clock.now(), last_source_id: source }).returning('id').executeTakeFirstOrThrow();
    await h.ctx.db.insertInto('ad_events').values({ platform: 'META', conversion_id: conversion.id, kind: 'SIGNUP', status: 'FAILED', attempts: 5, last_error: 'HTTP 400: refused', settled_at: h.clock.now() }).execute();
    const res = await auditor.get('/api/admin/ads/events?status=FAILED&platform=meta');
    expect(res.statusCode).toBe(200);
    const body = safeJson(res) as { events: Record<string, unknown>[] };
    expect(body.events).toEqual([
      {
        id: expect.any(Number),
        platform: 'META',
        kind: 'SIGNUP',
        status: 'FAILED',
        skipReason: null,
        attempts: 5,
        createdAt: expect.any(String),
        notBefore: expect.any(String),
        sentAt: null,
        settledAt: '2026-11-12T10:00:00.000Z',
        lastError: 'HTTP 400: refused',
      },
    ]);
    expect(res.body).not.toContain(account);
    expect(res.body).not.toContain(email);
    expect(safeJson(await auditor.get('/api/admin/ads/events?status=SENT'))).toEqual({ events: [] });
    const v = await view();
    expect(v.platforms[0]).toMatchObject({ counts: { FAILED: 1 }, lastError: { error: 'HTTP 400: refused', at: '2026-11-12T10:00:00.000Z' } });
  });

  it('switched off: the test refused (409 ADS_OFF), the switch’s author and time read', async () => {
    h.clock.advance(60_000);
    const off = await put(admin, '/api/admin/ads/switch', { on: false, phrase: 'switch off' });
    expect(safeJson(off)).toMatchObject({ on: false, eventsFrom: '2026-11-12T10:00:00.000Z', switchedAt: '2026-11-12T10:01:00.000Z' });
    const test = await admin.post('/api/admin/ads/test/META');
    expect([test.statusCode, errorOf(test).code]).toEqual([409, 'ADS_OFF']);
    expect(safeJson(await h.client().get('/api/v1/consent'))).toMatchObject({ ads: { on: false, choice: null } });
  });
});
