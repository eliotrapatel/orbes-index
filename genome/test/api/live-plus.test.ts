/**
 * Step S8 of LIVE RELEASE+ over HTTP (plan choices 10 to 13; services/question.ts, activity.ts, release-stock.ts), with
 * real sessions:
 *
 *  - the question after: GET /api/v1/live/:id/question and PUT /api/v1/live/:id/answer for the end page, GET
 *    /api/v1/account/questions for MY PIECES; 401 without a session, never kept by a cache, the CSRF token on the PUT,
 *    `{ question: null }` for anyone it is not asked of, 403 for their answer, the answer changed in one tap;
 *  - the console's readings: the size mix proposed at creation, the feasibility check, the best time to open on the
 *    release and in Analytics (AUDITOR and up), each counting the activity first;
 *  - a release's settings: its question and its location, as the console sends them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../../src/server/types.js';
import { createLiveRelease, holdPieces, liveFixtureOn, type LiveFixture } from '../support/live.js';
import { accountClient, adminClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const START = '2026-11-02T09:00:00.000Z';
const T0 = new Date('2026-11-02T10:00:00.000Z');

interface Collector {
  client: Client;
  id: string;
  actor: Actor;
}

describe('the question after, the stock and the best time over HTTP', () => {
  let h: Harness;
  let f: LiveFixture;
  let auditor: Client;
  let operator: Client;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(START);
    f = await liveFixtureOn(h.ctx, h.clock);
    auditor = await adminClient(h, 'AUDITOR');
    operator = await adminClient(h, 'OPERATOR');
  });
  afterAll(() => h?.close());

  async function collector(pieces = 0): Promise<Collector> {
    const { client, email } = await accountClient(h);
    const { id } = await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email.toLowerCase()).executeTakeFirstOrThrow();
    if (pieces) await holdPieces(h.ctx.db, id, pieces, f.modelId);
    return { client, id, actor: { type: 'account', id } };
  }

  it('asks the question after on the end page and in MY PIECES, one tap, changeable, never cached', async () => {
    const r = await createLiveRelease(f, { opensAt: T0, sizes: [{ label: '52', stock: 1 }] });
    const size = r.sizes[0]!.id;
    const [buyer, waiting, absent, stranger] = [await collector(5), await collector(), await collector(), await collector()];
    for (const c of [waiting, absent]) await f.live.setInterest(c.id, r.id, size, c.actor);
    h.clock.set(new Date(T0.getTime() - MINUTE));
    for (const c of [buyer, waiting]) await f.live.enter(c.id, r.id, { sizeId: size }, c.actor);
    h.clock.set(T0);
    await f.live.advance(r.id);
    const token = (await f.live.entry(buyer.id, r.id))!.turn!.token!;
    await f.live.press(buyer.id, r.id, token);
    h.clock.advance(1500);
    await f.live.secure(buyer.id, r.id, token, buyer.actor);
    // Before the end: no question, the answer refused.
    let res = await waiting.client.get(`/api/v1/live/${r.id}/question`);
    expect(res.statusCode).toBe(200);
    expect(safeJson(res)).toEqual({ question: null });
    res = await waiting.client.request('PUT', `/api/v1/live/${r.id}/answer`, { body: { answer: 1 } });
    expect([res.statusCode, errorOf(res).code]).toEqual([409, 'LIVE_QUESTION_CLOSED']);
    await f.live.confirm(buyer.id, r.id, buyer.actor);
    await f.live.advance(r.id);

    res = await waiting.client.get(`/api/v1/live/${r.id}/question`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const ended = (await h.ctx.db.selectFrom('drops').select('ended_at').where('id', '=', r.id).executeTakeFirstOrThrow()).ended_at!;
    expect(safeJson(res)).toEqual({
      question: {
        dropId: r.id,
        name: 'MONOLITHE',
        opensAt: T0.toISOString(),
        text: 'WHAT WOULD YOU HAVE WANTED?',
        answers: ['ANOTHER SIZE', 'ANOTHER FINISH', 'ANOTHER PRICE BAND'],
        answer: null,
        closesAt: new Date(ended.getTime() + 7 * 24 * HOUR).toISOString(),
        asked: 'TOOK_PART',
      },
    });
    // The CSRF token, then one tap and another.
    res = await waiting.client.request('PUT', `/api/v1/live/${r.id}/answer`, { body: { answer: 1 }, noCsrf: true });
    expect(res.statusCode).toBe(403);
    res = await waiting.client.request('PUT', `/api/v1/live/${r.id}/answer`, { body: { answer: 2 } });
    expect(res.statusCode).toBe(200);
    expect(safeJson(res)).toMatchObject({ question: { answer: 2, asked: 'TOOK_PART' } });
    res = await waiting.client.request('PUT', `/api/v1/live/${r.id}/answer`, { body: { answer: 3 } });
    expect(safeJson(res)).toMatchObject({ question: { answer: 3 } });
    res = await waiting.client.request('PUT', `/api/v1/live/${r.id}/answer`, { body: { answer: 7 } });
    expect([res.statusCode, errorOf(res).code]).toEqual([400, 'VALIDATION_FAILED']);

    // MY PIECES: the one who said I'LL BE THERE and never came.
    res = await absent.client.get('/api/v1/account/questions');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(safeJson(res)).toMatchObject({ questions: [{ dropId: r.id, asked: 'INTEREST', answer: null }] });
    expect(safeJson(await waiting.client.get('/api/v1/account/questions'))).toEqual({ questions: [] });
    // Never asked: the buyer, a stranger; without a session, 401.
    for (const c of [buyer, stranger]) {
      expect(safeJson(await c.client.get(`/api/v1/live/${r.id}/question`))).toEqual({ question: null });
      res = await c.client.request('PUT', `/api/v1/live/${r.id}/answer`, { body: { answer: 1 } });
      expect([res.statusCode, errorOf(res).code]).toEqual([403, 'LIVE_QUESTION_NOT_ASKED']);
    }
    res = await h.app.inject({ method: 'GET', url: `/api/v1/live/${r.id}/question` });
    expect(res.statusCode).toBe(401);
    res = await h.app.inject({ method: 'GET', url: '/api/v1/account/questions' });
    expect(res.statusCode).toBe(401);

    // The console reads the count (an AUDITOR included).
    res = await auditor.get(`/api/admin/live/${r.id}`);
    expect((safeJson(res) as { question: unknown }).question).toMatchObject({
      state: 'OPEN',
      asked: { tookPart: 1, interest: 1 },
      answered: 1,
      tally: [
        { answer: 1, label: 'ANOTHER SIZE', count: 0 },
        { answer: 2, label: 'ANOTHER FINISH', count: 0 },
        { answer: 3, label: 'ANOTHER PRICE BAND', count: 1 },
      ],
    });
  });

  it('serves the console its size mix, feasibility check and best time, and takes a release’s question and location', async () => {
    h.clock.set('2026-11-05T09:00:00.000Z');
    // Console sessions of today (those of the first test have ended with its days).
    auditor = await adminClient(h, 'AUDITOR');
    operator = await adminClient(h, 'OPERATOR');
    const locations = await h.ctx.db.selectFrom('stock_locations').select(['id', 'name']).orderBy('name').execute();
    const logistics = locations.find((l) => l.name === 'LOGISTICS WAREHOUSE')!.id;
    let res = await auditor.get(`/api/admin/live/size-mix?modelId=${f.modelId}&locationId=${logistics}`);
    expect(res.statusCode).toBe(200);
    expect(safeJson(res)).toMatchObject({ model: { id: f.modelId, name: 'MONOLITHE' }, location: { id: logistics, name: 'LOGISTICS WAREHOUSE' }, sizes: [], inStock: 0 });

    res = await operator.post('/api/admin/live', {
      modelId: f.modelId,
      title: 'THE QUESTION',
      opensAt: '2026-11-06T18:00:00.000Z',
      closesAt: '2026-11-06T19:00:00.000Z',
      priceMinor: 100_000,
      sizes: [{ label: '52', stock: 2 }],
      stockLocationId: logistics,
      questionText: 'WHICH FINISH?',
      questionAnswers: ['GOLD', 'SILVER'],
    });
    expect(res.statusCode).toBe(201);
    const created = safeJson(res) as { id: string; locationId: string; location: { name: string }; question: { text: string; answers: string[]; custom: boolean; enabled: boolean } };
    expect(created).toMatchObject({ locationId: logistics, location: { name: 'LOGISTICS WAREHOUSE' }, question: { text: 'WHICH FINISH?', answers: ['GOLD', 'SILVER'], custom: true, enabled: true } });
    res = await operator.patch(`/api/admin/live/${created.id}`, { questionAnswers: ['GOLD', 'SILVER', 'A', 'B', 'C', 'D', 'E'] });
    expect([res.statusCode, errorOf(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    res = await operator.patch(`/api/admin/live/${created.id}`, { questionEnabled: false, stockLocationId: '' });
    expect(safeJson(res)).toMatchObject({ locationId: null, location: { name: 'FRANCE WAREHOUSE' }, question: { enabled: false, state: 'OFF' } });

    res = await auditor.get(`/api/admin/live/${created.id}/feasibility`);
    expect(res.statusCode).toBe(200);
    expect(safeJson(res)).toMatchObject({ location: { name: 'FRANCE WAREHOUSE' }, sizes: [{ label: '52', onSale: 2, available: 0, fromStock: 0, short: 2 }], afterRoom: null, short: 2 });
    // What is already ordered for the size to the location (plan NEXT LOT §3.5.4.3, §3.5.6.4): nothing, then one piece in
    // its supplier's draft; the console adds only the rest.
    const sizeLine = () => (safeJson(res) as { sizes: { skuId: string; supplier: { name: string } | null; ordered: { expected: number; inDraft: number } | null }[] }).sizes[0]!;
    expect(sizeLine()).toMatchObject({ supplier: null, ordered: { expected: 0, inDraft: 0 } });
    const nord = await h.ctx.services.suppliers.create({ name: 'MAISON NORD', currency: 'EUR' }, f.admin);
    await h.ctx.services.suppliers.setModelSupplier(f.modelId, { supplierId: nord.id }, f.admin);
    const france = (await h.ctx.db.selectFrom('stock_locations').select('id').where('name', '=', 'FRANCE WAREHOUSE').executeTakeFirstOrThrow()).id;
    await h.ctx.services.supplierOrders.addToDraft({ skuId: sizeLine().skuId, locationId: france, quantity: 1, from: 'RELEASE' }, f.admin);
    res = await auditor.get(`/api/admin/live/${created.id}/feasibility`);
    expect(sizeLine()).toMatchObject({ supplier: { name: 'MAISON NORD' }, ordered: { expected: 0, inDraft: 1 } });

    res = await auditor.get(`/api/admin/live/${created.id}/best-time?country=fr`);
    expect(res.statusCode).toBe(200);
    expect(safeJson(res)).toMatchObject({ days: 30, minTier: 0, country: 'FR', release: { hour: 19 } });
    res = await auditor.get('/api/admin/analytics/best-time?days=90&tier=2');
    expect(res.statusCode).toBe(200);
    const body = safeJson(res) as { days: number; minTier: number; hours: unknown[]; country: null };
    expect(body).toMatchObject({ days: 90, minTier: 2, country: null, release: null });
    expect(body.hours).toHaveLength(24);
    // Counted first: the sign-ins of this test's collectors are in the table once their hours are complete.
    h.clock.advance(HOUR);
    await auditor.get('/api/admin/analytics/best-time');
    const counted = await h.ctx.db.selectFrom('activity_hourly').select((eb) => eb.fn.sum<number>('sign_ins').as('n')).executeTakeFirstOrThrow();
    expect(Number(counted.n)).toBeGreaterThan(0);
    for (const url of ['/api/admin/analytics/best-time?country=FRA', '/api/admin/analytics/best-time?tier=9', `/api/admin/live/size-mix?modelId=${f.modelId}&locationId=x`]) {
      res = await auditor.get(url);
      expect([res.statusCode, errorOf(res).code], url).toEqual([400, 'VALIDATION_FAILED']);
    }
  });
});
