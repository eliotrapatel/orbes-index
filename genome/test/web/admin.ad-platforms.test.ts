/**
 * Links → Ad platforms in the console (macro scope K27 A1 to A5; lot M4 plan §3.5, step M4.12): the page's model
 * (model/ad-platforms.ts), its route and roles, and the API client's calls.
 *
 *  - The page: #/links/ads, under Links in the sidebar, entered from the Links page; what GET /api/admin/ads sends is what
 *    the console reads (compile-time), the phrases and API versions the server's.
 *  - The off state and each section's empty state said plainly: off, no channel mapped, no choice this month, no event.
 *  - Who may do what: an ADMIN switches, maps, names and tests (while on); every reader of Links reads.
 *  - The dialogs: what the server would refuse said first (a Google action's pattern, a test code's length), only a
 *    change sent; the test's words before it goes and its answer after.
 *  - The words: calm, no exclamation mark, never atelier, handmade or craft, never « product ».
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADS_API_VERSIONS, ADS_SWITCH_PHRASES, type AdEventView as ServerEvent, type AdsSettingsView as ServerSettings, type AdsTestResult as ServerTest } from '../../src/server/services/ads.js';
import { AdminApi, type FetchLike } from '../../src/web/admin/api.js';
import { formatCount } from '../../src/web/admin/format.js';
import {
  ACT_LABELS,
  AD_PLATFORMS_TEXT as T,
  adPlatformActions,
  anyChannelMapped,
  channelChange,
  channelPlatformsText,
  consentEmpty,
  countCells,
  eventsEmptyText,
  eventsFilter,
  eventsQuery,
  googleActionsForm,
  googleActionsInput,
  googleActionsProblem,
  keysLabel,
  lastErrorText,
  lastSendText,
  monthLabel,
  switchLine,
  testCodeText,
  testCodesForm,
  testCodesInput,
  testCodesProblem,
  testEventBody,
  testResultLines,
} from '../../src/web/admin/model/ad-platforms.js';
import { LINKS_COPY } from '../../src/web/admin/model/links.js';
import { can, CAPABILITY_MIN_ROLE } from '../../src/web/admin/model/permissions.js';
import { toneOf } from '../../src/web/admin/model/tone.js';
import { href, parseHash } from '../../src/web/admin/router.js';
import type * as web from '../../src/web/admin/types.js';

/** A server value as JSON carries it: dates become ISO strings. */
type Json<T> = T extends Date ? string : T extends readonly (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
// Compile-time: the console reads exactly what the routes send.
export const adsSettingsFits = (s: Json<ServerSettings>): web.AdsSettings => s;
export const adEventFits = (e: Json<ServerEvent>): web.AdEventView => e;
export const adsTestFits = (r: Json<ServerTest>): web.AdsTestResult => r;

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'web');

const counts = (q: number, s: number, f: number, k: number): Record<web.AdEventStatus, number> => ({ QUEUED: q, SENT: s, FAILED: f, SKIPPED: k, CANCELLED: 0 });
const settings = (over: Partial<web.AdsSettings> = {}): web.AdsSettings => ({
  on: false,
  eventsFrom: null,
  switchedAt: null,
  switchedBy: null,
  phrases: { ...ADS_SWITCH_PHRASES },
  platforms: [
    { platform: 'META', ready: false, apiVersion: 'v24.0', lastSentAt: null, lastError: null, counts: counts(0, 0, 0, 0), testCode: null },
    { platform: 'TIKTOK', ready: false, apiVersion: 'v1.3', lastSentAt: null, lastError: null, counts: counts(0, 0, 0, 0), testCode: null },
    { platform: 'GOOGLE', ready: false, apiVersion: 'v22', lastSentAt: null, lastError: null, counts: counts(0, 0, 0, 0), testCode: null },
  ],
  channels: [
    { id: 'c1', name: 'Instagram', platforms: [] },
    { id: 'c2', name: 'Search', platforms: [] },
  ],
  googleActions: { SIGNUP: null, DRAW_ENTRY: null, LIVE_ENTRY: null, PAID_ORDER: null },
  consent: { month: '2026-10', granted: 0, declined: 0 },
  ...over,
});

describe('Links → Ad platforms: the page and its roles', () => {
  it('is #/links/ads under Links, read by every reader of Links, changed by an ADMIN only (manageAdPlatforms), as the server', () => {
    expect(href('adPlatforms')).toBe('#/links/ads');
    // Before a link's page: « ads » is never read as a link's id.
    expect(['#/links/ads', '#/links/ads?status=FAILED', '#/links/collectors', '#/links/0b9f'].map((x) => parseHash(x).name)).toEqual(['adPlatforms', 'adPlatforms', 'linkCollectors', 'link']);
    expect(parseHash('#/links/ads?status=FAILED&platform=META').query).toEqual({ status: 'FAILED', platform: 'META' });
    expect(CAPABILITY_MIN_ROLE.manageAdPlatforms).toBe('ADMIN');
    const roles = ['RETAIL', 'LOGISTICS', 'AUDITOR', 'OPERATOR', 'ADMIN'] as const;
    expect(roles.map((r) => can(r, 'readLinks'))).toEqual([false, false, true, true, true]);
    expect(roles.map((r) => adPlatformActions(r, { on: false }))).toEqual([
      { manage: false, test: false },
      { manage: false, test: false },
      { manage: false, test: false },
      { manage: false, test: false },
      { manage: true, test: false },
    ]);
    expect(adPlatformActions('ADMIN', { on: true })).toEqual({ manage: true, test: true });
    expect(adPlatformActions('OPERATOR', { on: true })).toEqual({ manage: false, test: false });
    expect(LINKS_COPY.adPlatforms).toBe('Ad platforms');
  });

  it('says the off state plainly, and the switch dialog says what goes live (plan §3.5, word for word); the phrases and API versions are the server\'s', () => {
    expect(T.offLine).toBe('Conversions are off. Nothing is captured or sent, and collectors see no banner.');
    expect(T.switchOnBody).toBe('The consent banner and the privacy policy’s advertising section appear at once. Events are sent only for collectors who accept, from now on.');
    expect([T.switchOn, T.switchOff]).toEqual([ADS_SWITCH_PHRASES.on, ADS_SWITCH_PHRASES.off]);
    expect(settings().platforms.map((p) => p.apiVersion)).toEqual([ADS_API_VERSIONS.META, ADS_API_VERSIONS.TIKTOK, ADS_API_VERSIONS.GOOGLE]);
    expect(switchLine(settings())).toBeNull();
    expect(switchLine(settings({ on: true, switchedAt: '2026-10-26T09:30:00.000Z', switchedBy: { id: 'a', email: 'eliot@theorbes.com' } }))).toBe('Switched on 26 OCT 2026 · 10:30 Paris by eliot@theorbes.com');
    expect(switchLine(settings({ on: false, switchedAt: '2026-07-01T09:30:00.000Z', switchedBy: null }))).toBe('Switched off 01 JUL 2026 · 11:30 Paris');
  });

  it('reads each platform: KEYS PRESENT / KEYS MISSING, its last send and error in Paris time, the four counts, its test code or Google\'s test mode', () => {
    const [meta, , google] = settings().platforms;
    expect([keysLabel(meta), keysLabel({ ready: true })]).toEqual(['KEYS MISSING', 'KEYS PRESENT']);
    expect(lastSendText(meta)).toBe('Never');
    expect(lastSendText({ lastSentAt: '2026-10-26T10:41:00.000Z' })).toBe('26 OCT 2026 · 11:41 Paris');
    expect(lastErrorText(meta)).toBeNull();
    expect(lastErrorText({ lastError: { error: 'HTTP 500: retry', at: '2026-12-01T07:15:00.000Z' } })).toEqual({ error: 'HTTP 500: retry', at: '01 DEC 2026 · 08:15 Paris' });
    expect(countCells({ counts: counts(3, 1284, 2, 41) })).toEqual([
      { status: 'QUEUED', label: 'Queued', value: '3' },
      { status: 'SENT', label: 'Sent', value: formatCount(1284) },
      { status: 'FAILED', label: 'Failed', value: '2' },
      { status: 'SKIPPED', label: 'Skipped', value: '41' },
    ]);
    expect([testCodeText(meta), testCodeText({ platform: 'TIKTOK', testCode: 'TEST1' }), testCodeText(google)]).toEqual(['None', 'TEST1', T.googleTestMode]);
    expect((['QUEUED', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED'] as const).map((s) => toneOf('adEvent', s))).toEqual(['outline', 'solid', 'alert', 'muted', 'muted']);
  });

  it('says each section\'s empty state in its own words: no channel mapped, no choice this month, no event (or none for the filter)', () => {
    const s = settings();
    expect(anyChannelMapped(s)).toBe(false);
    expect(T.channelsEmpty).toMatch(/^No channel is mapped to a platform yet\./);
    expect(anyChannelMapped(settings({ channels: [{ id: 'c1', name: 'Instagram', platforms: ['META'] }] }))).toBe(true);
    expect(consentEmpty(s)).toBe(true);
    expect(consentEmpty(settings({ consent: { month: '2026-10', granted: 0, declined: 1 } }))).toBe(false);
    expect(T.consentEmpty).toBe('No choice made this month.');
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(eventsEmptyText({ status: null, platform: null })).toBe('No event yet.');
    expect(eventsEmptyText({ status: 'FAILED', platform: null })).toBe('No event with this status and platform.');
  });

  it('keeps the events\' filter in the address, anything unknown read as none', () => {
    expect(eventsFilter({ status: 'FAILED', platform: 'META' })).toEqual({ status: 'FAILED', platform: 'META' });
    expect(eventsFilter({ status: 'failed', platform: 'SNAPCHAT' })).toEqual({ status: null, platform: null });
    expect(eventsQuery({ status: 'SKIPPED', platform: null })).toEqual({ status: 'SKIPPED' });
    expect(eventsQuery({ status: null, platform: null })).toEqual({});
    expect(href('adPlatforms', {}, eventsQuery({ status: 'SENT', platform: 'GOOGLE' }))).toBe('#/links/ads?status=SENT&platform=GOOGLE');
  });
});

describe('Links → Ad platforms: the dialogs', () => {
  it('maps a channel: the ticked platforms in their order, sent only when they changed; words in their order', () => {
    expect(channelChange([], ['GOOGLE', 'META'])).toEqual({ platforms: ['META', 'GOOGLE'], changed: true });
    expect(channelChange(['GOOGLE', 'META'], ['META', 'GOOGLE'])).toEqual({ platforms: ['META', 'GOOGLE'], changed: false });
    expect(channelChange(['META'], [])).toEqual({ platforms: [], changed: true });
    expect([channelPlatformsText(['GOOGLE', 'META']), channelPlatformsText([])]).toEqual(['Meta · Google', 'None']);
  });

  it('names the Google conversion actions as the server\'s pattern, empty as not named, nothing sent when nothing changed', () => {
    const s = settings({ googleActions: { SIGNUP: 'customers/1234567890/conversionActions/111', DRAW_ENTRY: null, LIVE_ENTRY: null, PAID_ORDER: null } });
    const current = googleActionsForm(s);
    expect(current).toEqual({ signup: 'customers/1234567890/conversionActions/111', drawEntry: '', liveEntry: '', paidOrder: '' });
    expect(googleActionsProblem(current, current)).toBe(T.nothingChanged);
    expect(googleActionsProblem({ ...current, drawEntry: 'conversionActions/2' }, current)).toBe('A conversion action reads customers/<id>/conversionActions/<id>.');
    expect(googleActionsProblem({ ...current, signup: '', paidOrder: ' customers/1234567890/conversionActions/444 ' }, current)).toBeNull();
    expect(googleActionsInput({ ...current, signup: '', paidOrder: ' customers/1234567890/conversionActions/444 ' })).toEqual({ signup: null, drawEntry: null, liveEntry: null, paidOrder: 'customers/1234567890/conversionActions/444' });
    expect(Object.values(ACT_LABELS)).toEqual(['Sign-up', 'Draw entry', 'LIVE entry', 'Paid order']);
  });

  it('keeps Meta\'s and TikTok\'s test codes to one line of 40 characters, empty as none', () => {
    const s = settings({ platforms: settings().platforms.map((p) => (p.platform === 'META' ? { ...p, testCode: 'TEST1' } : p)) });
    const current = testCodesForm(s);
    expect(current).toEqual({ meta: 'TEST1', tiktok: '' });
    expect(testCodesProblem(current, current)).toBe(T.nothingChanged);
    expect(testCodesProblem({ meta: 'x'.repeat(41), tiktok: '' }, current)).toBe(T.testCodeProblem);
    expect(testCodesProblem({ meta: 'A\nB', tiktok: '' }, current)).toBe(T.testCodeProblem);
    expect(testCodesProblem({ meta: '', tiktok: 'TT1' }, current)).toBeNull();
    expect(testCodesInput({ meta: ' ', tiktok: ' TT1 ' })).toEqual({ meta: null, tiktok: 'TT1' });
  });

  it('says what a test event sends before it goes, and reads its answer after', () => {
    expect(testEventBody({ platform: 'META', testCode: 'TEST1' })).toBe('One sign-up in Meta’s test mode, with the test code TEST1, for the house’s test address, never a collector’s. Meta shows it under Test events.');
    expect(testEventBody({ platform: 'TIKTOK', testCode: null })).toMatch(/^TikTok’s test code is not set/);
    expect(testEventBody({ platform: 'GOOGLE', testCode: null })).toMatch(/validate only/);
    expect(testResultLines({ platform: 'META', ok: true, status: 200, answer: '{"events_received":1}' })).toEqual({ mark: 'TAKEN', ok: true, status: 'HTTP 200', answer: '{"events_received":1}' });
    expect(testResultLines({ platform: 'GOOGLE', ok: false, status: null, answer: '' })).toEqual({ mark: 'REFUSED', ok: false, status: 'No answer', answer: '—' });
  });
});

describe('Links → Ad platforms: the API client', () => {
  it('calls the ads routes with their methods and bodies, the CSRF token on every change', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ url, init });
      return new Response(url.includes('/events') ? '{"events":[]}' : '{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const api = new AdminApi({ fetch });
    api.setCsrf('tok');
    await api.adsSettings();
    await api.adsEvents();
    await api.adsEvents({ status: 'FAILED', platform: 'META' });
    await api.setAdsSwitch(true, 'SWITCH ON');
    await api.setAdsChannel('c1', ['META', 'GOOGLE']);
    await api.setAdsGoogleActions({ signup: 'customers/1/conversionActions/2', drawEntry: null, liveEntry: null, paidOrder: null });
    await api.setAdsTestCodes({ meta: 'TEST1', tiktok: null });
    await api.sendAdsTest('TIKTOK');
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'GET /api/admin/ads',
      'GET /api/admin/ads/events',
      'GET /api/admin/ads/events?status=FAILED&platform=META',
      'PUT /api/admin/ads/switch',
      'PUT /api/admin/ads/channels/c1',
      'PUT /api/admin/ads/google-actions',
      'PUT /api/admin/ads/test-codes',
      'POST /api/admin/ads/test/tiktok',
    ]);
    expect(calls.slice(3).map((c) => JSON.parse(String(c.init.body)))).toEqual([
      { on: true, phrase: 'SWITCH ON' },
      { platforms: ['META', 'GOOGLE'] },
      { signup: 'customers/1/conversionActions/2', drawEntry: null, liveEntry: null, paidOrder: null },
      { meta: 'TEST1', tiktok: null },
      {},
    ]);
    for (const c of calls.slice(3)) expect(new Headers(c.init.headers).get('x-csrf-token')).toBe('tok');
  });
});

describe('Links → Ad platforms: the words', () => {
  it('are calm: no atelier, handmade or craft, no exclamation mark, never « product », never a key\'s value', () => {
    for (const f of ['admin/model/ad-platforms.ts', 'admin/views/ad-platforms.ts']) {
      const code = readFileSync(join(WEB, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      expect(code, f).not.toMatch(/atelier|handmade|hand-made|craft/i);
      const words = [...code.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)].map((m) => m[1] ?? m[2] ?? '').join('\n');
      expect(words, f).not.toMatch(/!(?!==?)/);
      expect(words, f).not.toMatch(/\bproducts?\b/i);
      // The page never names an .env variable: keys are present or missing, nothing more.
      expect(code, f).not.toMatch(/ADS_(META_DATASET|META_ACCESS|TIKTOK_PIXEL|TIKTOK_ACCESS|GOOGLE_(CUSTOMER|LOGIN|DEVELOPER|CLIENT|REFRESH))/);
    }
  });
});
