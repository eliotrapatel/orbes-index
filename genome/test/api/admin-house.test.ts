/**
 * House messages in the console over HTTP (macro scope of 2026-10-20, D24 M1 and M2; lot M2 plan §1.4, step M2.3;
 * routes/admin/house.ts), with real sessions:
 *
 *  - the moments: read by an AUDITOR with their figures, their words set by an OPERATOR (an unknown placeholder 422
 *    HOUSE_PLACEHOLDER), switched by an ADMIN only, previewed;
 *  - a custom message: written, counted and changed by an OPERATOR, sent and cancelled by an ADMIN only, scheduled at a
 *    Paris time (422 HOUSE_SEND_PAST, the phrase SEND), delivered by the sender's pass and read in the collector's
 *    MESSAGES; the errors (404, 409 HOUSE_MESSAGE_SENT and HOUSE_MESSAGE_STATE, 422 HOUSE_AUDIENCE); never cached.
 * Which role reaches which route is test/api/admin-roles.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { holdPieces, liveFixtureOn, type LiveFixture } from '../support/live.js';
import { accountClient, adminClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

type Json = Record<string, any>;

describe('house messages: the console’s routes', () => {
  let h: Harness;
  let f: LiveFixture;
  let auditor: Client;
  let op: Client;
  let admin: Client;
  let collector: { client: Client; id: string };

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2027-01-10T09:00:00.000Z');
    f = await liveFixtureOn(h.ctx, h.clock);
    auditor = await adminClient(h, 'AUDITOR');
    op = await adminClient(h, 'OPERATOR');
    admin = await adminClient(h, 'ADMIN');
    const { client, email } = await accountClient(h);
    const { id } = await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email.toLowerCase()).executeTakeFirstOrThrow();
    collector = { client, id };
    await holdPieces(h.ctx.db, id, 5, f.modelId);
  });
  afterAll(() => h?.close());

  it('lists the moments for an AUDITOR; an OPERATOR words them, an ADMIN switches them', async () => {
    const res = await auditor.get('/api/admin/house/moments');
    expect([res.statusCode, res.headers['cache-control']]).toEqual([200, 'no-store']);
    const moments = (safeJson(res) as Json).moments as Json[];
    expect(moments.map((m) => m.moment)).toEqual(['FIRST_REGISTRATION', 'BIRTHDAY_CREDIT', 'CREDIT_EXPIRING', 'PRIVATE_CARE', 'OWNERSHIP_YEAR', 'NINETY_DAYS']);
    expect(moments[0]).toMatchObject({ enabled: false, enabledAt: null, title: null, body: null, defaults: { title: 'YOUR FIRST PIECE' }, links: ['CARE', 'SIZES'], figures: { delivered: 0, read: 0, delivered30: 0, read30: 0 } });

    const words = await op.request('PUT', '/api/admin/house/moments/ONE_YEAR_NOPE/words', { body: { title: 'X' } });
    expect([words.statusCode, errorOf(words).code]).toEqual([404, 'HOUSE_MOMENT_NOT_FOUND']);
    const unknown = await op.request('PUT', '/api/admin/house/moments/OWNERSHIP_YEAR/words', { body: { body: 'Until {expires}.' } });
    expect([unknown.statusCode, errorOf(unknown).code]).toEqual([422, 'HOUSE_PLACEHOLDER']);
    const set = await op.request('PUT', '/api/admin/house/moments/OWNERSHIP_YEAR/words', { body: { title: 'A YEAR, {firstName}' } });
    expect(set.statusCode).toBe(200);
    expect((safeJson(set) as Json).moment).toMatchObject({ moment: 'OWNERSHIP_YEAR', title: 'A YEAR, {firstName}', body: null, enabled: false });

    // The switch is an ADMIN's: an OPERATOR is refused before anything.
    const refused = await op.request('PUT', '/api/admin/house/moments/OWNERSHIP_YEAR/enabled', { body: { enabled: true } });
    expect([refused.statusCode, errorOf(refused).code]).toEqual([403, 'FORBIDDEN']);
    const on = await admin.request('PUT', '/api/admin/house/moments/OWNERSHIP_YEAR/enabled', { body: { enabled: true } });
    expect((safeJson(on) as Json).moment).toMatchObject({ enabled: true, enabledAt: '2027-01-10T09:00:00.000Z' });
    await admin.request('PUT', '/api/admin/house/moments/OWNERSHIP_YEAR/enabled', { body: { enabled: false } });

    const preview = safeJson(await auditor.get('/api/admin/house/moments/OWNERSHIP_YEAR/preview')) as Json;
    expect(preview).toMatchObject({ moment: 'OWNERSHIP_YEAR', title: 'A YEAR, Camille', links: ['PIECE'] });
    const draft = safeJson(await op.post('/api/admin/house/moments/OWNERSHIP_YEAR/preview', { title: null, body: '{piece}, a year.' })) as Json;
    expect(draft).toMatchObject({ title: 'ONE YEAR', body: 'MONOLITHE, a year.' });
    expect((await auditor.post('/api/admin/house/moments/OWNERSHIP_YEAR/preview', {})).statusCode).toBe(403);
  });

  it('writes, counts, schedules in Paris, delivers and cancels a custom message, each by its role', async () => {
    const created = await op.post('/api/admin/house/messages', { title: 'FOR PLATINE', body: 'Dear {firstName},\n\nA word from the house.', audience: { tier: 2 } });
    expect(created.statusCode).toBe(201);
    const m = safeJson(created) as Json;
    expect(m).toMatchObject({ status: 'DRAFT', audience: { tier: 2, segmentId: null, label: 'PLATINE and above' }, reachNow: 1, reach: null });

    const counted = await op.post('/api/admin/house/count', { audience: { tier: 2 } });
    expect([counted.statusCode, safeJson(counted)]).toEqual([200, { count: 1 }]);
    expect((await op.post('/api/admin/house/count', { audience: { tier: 3 } })).body).toBe('{"count":0}');
    const neither = await op.post('/api/admin/house/count', { audience: {} });
    expect([neither.statusCode, errorOf(neither).code]).toEqual([422, 'HOUSE_AUDIENCE']);
    const both = await op.post('/api/admin/house/messages', { title: 'T', body: 'B', audience: { tier: 1, segmentId: '00000000-0000-4000-8000-000000000000' } });
    expect([both.statusCode, errorOf(both).code]).toEqual([422, 'HOUSE_AUDIENCE']);
    expect((await op.post('/api/admin/house/messages', { title: 'T', body: 'B', audience: { tier: 4 } })).statusCode).toBe(400);
    expect((await auditor.post('/api/admin/house/count', { audience: { tier: 2 } })).statusCode).toBe(403);

    const patched = await op.patch(`/api/admin/house/messages/${m.id}`, { title: 'FOR OUR PLATINE' });
    expect([patched.statusCode, (safeJson(patched) as Json).title]).toEqual([200, 'FOR OUR PLATINE']);
    expect((await op.patch(`/api/admin/house/messages/${m.id}`, {})).statusCode).toBe(400);

    // Sending is an ADMIN's, the phrase SEND typed, a Paris time to come.
    const opSend = await op.post(`/api/admin/house/messages/${m.id}/send`, { phrase: 'SEND' });
    expect([opSend.statusCode, errorOf(opSend).code]).toEqual([403, 'FORBIDDEN']);
    const noPhrase = await admin.post(`/api/admin/house/messages/${m.id}/send`, { phrase: 'GO' });
    expect([noPhrase.statusCode, errorOf(noPhrase).code]).toEqual([400, 'VALIDATION_FAILED']);
    const past = await admin.post(`/api/admin/house/messages/${m.id}/send`, { at: '2027-01-10T09:00', phrase: 'SEND' });
    expect([past.statusCode, errorOf(past).code]).toEqual([422, 'HOUSE_SEND_PAST']);
    expect((await admin.post(`/api/admin/house/messages/${m.id}/send`, { at: '2027-01-10 18:00', phrase: 'SEND' })).statusCode).toBe(400);
    const scheduled = await admin.post(`/api/admin/house/messages/${m.id}/send`, { at: '2027-01-10T18:00', phrase: 'SEND' });
    expect([scheduled.statusCode, (safeJson(scheduled) as Json).status, (safeJson(scheduled) as Json).sendAt]).toEqual([200, 'SCHEDULED', '2027-01-10T17:00:00.000Z']);

    const listed = safeJson(await auditor.get('/api/admin/house/messages?status=SCHEDULED')) as Json;
    expect(listed).toMatchObject({ page: 1, total: 1, items: [{ id: m.id, status: 'SCHEDULED' }] });
    expect((await auditor.get('/api/admin/house/messages?status=NOPE')).statusCode).toBe(400);

    // Delivered by the sender's pass at its time; read in MESSAGES.
    h.clock.set('2027-01-10T17:00:10.000Z');
    await h.ctx.services.houseMessages.deliverDue(h.clock.now());
    // Eight hours on: the console's sessions are signed in again.
    [auditor, op, admin] = [await adminClient(h, 'AUDITOR'), await adminClient(h, 'OPERATOR'), await adminClient(h, 'ADMIN')];
    const mine = safeJson(await collector.client.get('/api/v1/account/house-messages')) as Json;
    expect(mine).toMatchObject({ unread: 1, total: 1, messages: [{ source: 'CUSTOM', title: 'FOR OUR PLATINE', unread: true }] });
    expect((await collector.client.post('/api/v1/account/house-messages/read', { upTo: '2027-01-10T17:00:10.000Z' })).statusCode).toBe(204);
    expect(safeJson(await auditor.get(`/api/admin/house/messages/${m.id}`))).toMatchObject({ status: 'SENT', reach: 1, read: 1, shareRead: 1, reachNow: null });

    // Sent: nothing changes.
    const again = await op.patch(`/api/admin/house/messages/${m.id}`, { title: 'AGAIN' });
    expect([again.statusCode, errorOf(again).code]).toEqual([409, 'HOUSE_MESSAGE_SENT']);
    const del = await op.request('DELETE', `/api/admin/house/messages/${m.id}`);
    expect([del.statusCode, errorOf(del).code]).toEqual([409, 'HOUSE_MESSAGE_SENT']);

    // A second one scheduled, then cancelled by an ADMIN; a draft deleted by an OPERATOR.
    const second = safeJson(await op.post('/api/admin/house/messages', { title: 'LATER', body: 'Words.', audience: { tier: 1 } })) as Json;
    await admin.post(`/api/admin/house/messages/${second.id}/send`, { at: '2027-01-11T10:00', phrase: 'SEND' });
    expect((await op.post(`/api/admin/house/messages/${second.id}/cancel`, {})).statusCode).toBe(403);
    const cancelled = await admin.post(`/api/admin/house/messages/${second.id}/cancel`, {});
    expect([cancelled.statusCode, (safeJson(cancelled) as Json).status]).toEqual([200, 'CANCELLED']);
    const twice = await admin.post(`/api/admin/house/messages/${second.id}/cancel`, {});
    expect([twice.statusCode, errorOf(twice).code]).toEqual([409, 'HOUSE_MESSAGE_STATE']);
    const third = safeJson(await op.post('/api/admin/house/messages', { title: 'DRAFT', body: 'Words.', audience: { tier: 1 } })) as Json;
    expect((await op.request('DELETE', `/api/admin/house/messages/${third.id}`)).statusCode).toBe(204);
    const gone = await auditor.get(`/api/admin/house/messages/${third.id}`);
    expect([gone.statusCode, errorOf(gone).code]).toEqual([404, 'HOUSE_MESSAGE_NOT_FOUND']);
  });
});
