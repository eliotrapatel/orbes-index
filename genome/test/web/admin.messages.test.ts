/**
 * The Messages board of the console (plan NEXT-NINE of 2026-10-06, §3.1 CS-01, step 1.3), its pure parts and its API
 * client: the filters read from the route, what a conversation concerns in words and where its link goes, the priority
 * tag, the badge's text, who may do what, the answer's check (its bound mirrored from the server); AdminApi's paths,
 * methods and bodies; and, against the server, the board's order (To answer first: PALLADIUM, then PLATINE, then the
 * rest, the longest waiting first) and the badge's count.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { MESSAGE_LIMITS as SERVER_LIMITS } from '../../src/server/services/messages.js';
import { createManualClock, type ManualClock } from '../../src/server/types.js';
import { AdminApi, type FetchLike } from '../../src/web/admin/api.js';
import {
  answerProblem,
  boardFilters,
  boardQuery,
  canAnswer,
  canAssign,
  concernsHref,
  concernsText,
  MESSAGE_LIMITS,
  messagesBadge,
  moreText,
  priorityTag,
  statusFilterLabel,
} from '../../src/web/admin/model/messages.js';
import type { MessageConcerns } from '../../src/web/admin/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { accountOfTier, liveFixtureOn, type LiveFixture } from '../support/live.js';

const ID = '3f9a21c4-1b2c-4d3e-8f90-a1b2c3d4e5f6';
const concerns = (c: Partial<MessageConcerns> & Pick<MessageConcerns, 'kind' | 'label'>): MessageConcerns => ({
  productId: null,
  orderId: null,
  dropId: null,
  dropMode: null,
  modelId: null,
  shopRequestId: null,
  scanEventId: null,
  scanRef: null,
  ...c,
});

describe('the Messages board: its words and links', () => {
  it('reads its filters from the route, To answer by default', () => {
    expect(boardFilters({})).toEqual({ status: 'TO_ANSWER', who: '', q: '' });
    expect(boardFilters({ status: 'ALL', who: 'mine', q: '  5a864af8 ' })).toEqual({ status: 'ALL', who: 'mine', q: '5a864af8' });
    expect(boardFilters({ status: 'OPEN', who: 'everyone' })).toEqual({ status: 'TO_ANSWER', who: '', q: '' });
    expect(boardQuery(boardFilters({ who: 'unassigned' }), 2)).toEqual({ status: 'TO_ANSWER', who: 'unassigned', page: 2, pageSize: 50 });
    expect(statusFilterLabel('TO_ANSWER', 3)).toBe('To answer (3)');
    expect(statusFilterLabel('CLOSED', 3)).toBe('Closed');
  });

  it('says what a conversation concerns, and opens its page', () => {
    expect(concernsText(null)).toBe('General');
    const piece = concerns({ kind: 'PIECE', label: 'MONOLITHE · O26-J-00184', productId: 'O26-J-00184' });
    expect([concernsText(piece), concernsHref(piece)]).toEqual(['Piece O26-J-00184', '#/products/O26-J-00184']);
    const order = concerns({ kind: 'ORDER', label: 'ORDER OR-3F9A21C4 · MONOLITHE', orderId: ID });
    expect([concernsText(order), concernsHref(order)]).toEqual(['Order OR-3F9A21C4', `#/orders/${ID}`]);
    const live = concerns({ kind: 'RELEASE', label: 'MONOLITHE IN STEEL · CONFIRMED · REFERENCE LR-8K2M4Q', dropId: ID, dropMode: 'LIVE' });
    expect([concernsText(live), concernsHref(live)]).toEqual(['Release Monolithe in steel', `#/club/live/${ID}`]);
    expect(concernsHref({ ...live, dropMode: 'DRAW' })).toBe(`#/club/drops/${ID}`);
    const scan = concerns({ kind: 'SCAN', label: 'REF 5A864AF8 · INVALID SIGNATURE', scanRef: '5A864AF8', scanEventId: ID });
    expect([concernsText(scan), concernsHref(scan)]).toEqual(['Scan REF 5A864AF8 · Invalid signature', `#/scans?scanId=${ID}`]);
    // Once the scan retention has cleared the scan, the chip has no link; the REF stays.
    expect([concernsText({ ...scan, scanEventId: null }), concernsHref({ ...scan, scanEventId: null })]).toEqual(['Scan REF 5A864AF8 · Invalid signature', null]);
    const salon = concerns({ kind: 'MODEL', label: 'ECLIPSE · PRIVATE SALON REQUEST', modelId: ID, shopRequestId: ID });
    expect([concernsText(salon), concernsHref(salon)]).toEqual(['Model Eclipse · salon request', '#/club?tab=requests']);
    const model = concerns({ kind: 'MODEL', label: 'AURORE', modelId: ID });
    expect([concernsText(model), concernsHref(model)]).toEqual(['Model Aurore', `#/catalogue/${ID}`]);
    expect(moreText(2)).toBe('+2 more');
    expect(moreText(0)).toBeNull();
  });

  it('marks priority from PLATINE, counts the badge, and lets each role do only its part', () => {
    expect(priorityTag('PALLADIUM')).toBe('Priority · PALLADIUM');
    expect(priorityTag('PLATINE')).toBe('Priority · PLATINE');
    expect(priorityTag(null)).toBeNull();
    expect(messagesBadge(0)).toBe('');
    expect(messagesBadge(4)).toBe('4');
    expect(['RETAIL', 'AUDITOR', 'OPERATOR', 'ADMIN'].map((r) => canAnswer(r as 'ADMIN'))).toEqual([false, false, true, true]);
    expect(['RETAIL', 'AUDITOR', 'OPERATOR', 'ADMIN'].map((r) => canAssign(r as 'ADMIN'))).toEqual([false, false, false, true]);
  });

  it('checks an answer as the server does', () => {
    expect(MESSAGE_LIMITS.staff).toBe(SERVER_LIMITS.staff);
    expect(answerProblem('  ')).toBe('Write the answer.');
    expect(answerProblem('x'.repeat(4001))).toBe('An answer is limited to 4,000 characters.');
    expect(answerProblem('x'.repeat(4000))).toBeNull();
  });

  it('calls each route with its method and body, the CSRF token on every change', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const api = new AdminApi({ fetch });
    api.setCsrf('tok');
    await api.messages({ status: 'ALL', who: 'mine', q: 'a@b.c' });
    await api.messagesSummary({ background: true });
    await api.conversation(ID);
    await api.answerConversation(ID, 'Our answer.');
    await api.takeConversation(ID);
    await api.assignConversation(ID, ID);
    await api.closeConversation(ID);
    expect(calls.map((c) => `${c.init.method ?? 'GET'} ${c.url}`)).toEqual([
      'GET /api/admin/messages?status=ALL&who=mine&q=a%40b.c',
      'GET /api/admin/messages/summary',
      `GET /api/admin/messages/${ID}`,
      `POST /api/admin/messages/${ID}/answer`,
      `POST /api/admin/messages/${ID}/take`,
      `POST /api/admin/messages/${ID}/assign`,
      `POST /api/admin/messages/${ID}/close`,
    ]);
    expect(JSON.parse(String(calls[3]!.init.body))).toEqual({ body: 'Our answer.' });
    expect(JSON.parse(String(calls[5]!.init.body))).toEqual({ adminId: ID });
    for (const c of calls.filter((x) => x.init.method === 'POST')) expect(new Headers(c.init.headers).get('x-csrf-token')).toBe('tok');
  });
});

describe('the Messages board: its order and its badge, as the server gives them', () => {
  let t: TestDb;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: LiveFixture;

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock('2026-11-01T09:00:00.000Z');
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    f = await liveFixtureOn(ctx, clock);
  });
  afterAll(async () => {
    await ctx.close();
    await t.close();
  });

  it('sorts To answer by priority, then by waiting time; the badge counts To answer', async () => {
    const order: { tier: 0 | 1 | 2 | 3; id?: string }[] = [{ tier: 2 }, { tier: 0 }, { tier: 3 }, { tier: 1 }, { tier: 3 }, { tier: 2 }];
    for (const o of order) {
      const a = await accountOfTier(f, o.tier);
      o.id = a.id;
      await ctx.services.messages.write(a.id, { body: 'Hello.' }, a.actor);
      clock.advance(60_000);
    }
    const board = await ctx.services.messages.board({}, { page: 1, pageSize: 50 }, f.admin);
    // PALLADIUM (the third, then the fifth), PLATINE (the first, then the sixth), then the rest by waiting time.
    expect(board.items.map((r) => r.account.id)).toEqual([order[2], order[4], order[0], order[5], order[1], order[3]].map((o) => o!.id));
    expect(board.items.map((r) => priorityTag(r.priority))).toEqual(['Priority · PALLADIUM', 'Priority · PALLADIUM', 'Priority · PLATINE', 'Priority · PLATINE', null, null]);
    const summary = await ctx.services.messages.summary();
    expect(summary).toEqual({ toAnswer: 6, priority: 4 });
    expect(messagesBadge(summary.toAnswer)).toBe('6');
  });
});
