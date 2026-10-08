/**
 * MESSAGES for the collector (plan NEXT-NINE of 2026-10-06, §3.1 CS-01; API §10.17): 401 signed out, the CSRF token and
 * the same origin on every write, `no-store` on every answer, the shapes (each context kind's `path`, a scan's null),
 * and staff never named to the collector.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { accountClient, adminClient, createHarness, errorOf, issue, safeJson, seedCatalog, type Catalog, type Client, type Harness } from './support.js';
import { poolDraw } from '../support/draws.js';

interface MessageJson {
  id: string;
  from: 'YOU' | 'ORBES_CLIENT_SERVICES';
  body: string;
  at: string;
  concerning: { kind: string; label: string; path: string | null } | null;
}

describe('MESSAGES for the collector (CS-01)', () => {
  let h: Harness;
  let catalog: Catalog;
  let me: { client: Client; email: string };
  let operator: Client;
  let serial: string;
  let scanId: string;

  beforeAll(async () => {
    h = await createHarness();
    catalog = await seedCatalog(h.ctx);
    me = await accountClient(h);
    operator = await adminClient(h, 'OPERATOR');
    // A piece registered to the account: its scan, then its registration.
    const p = await issue(h.ctx, catalog);
    await h.ctx.services.warranty.activate(p.product.productId, { retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    const scan = safeJson(await me.client.post('/api/v1/verify', { code: p.code.data })) as { scanId: string; registration: { token: string } };
    expect((await me.client.post('/api/v1/ownership/register', { registrationToken: scan.registration.token })).statusCode).toBe(201);
    serial = p.product.productId;
    scanId = scan.scanId;
  });
  afterAll(() => h?.close());

  it('answers 401 to a visitor who is not signed in, on every route', async () => {
    const anon = h.client();
    for (const [method, url, body] of [
      ['GET', '/api/v1/account/messages'],
      ['POST', '/api/v1/account/messages', { body: 'Hello.' }],
      ['POST', '/api/v1/account/messages/read', { upTo: new Date().toISOString() }],
      ['GET', '/api/v1/account/messages/unread'],
    ] as const) {
      const res = await anon.request(method, url, body ? { body } : {});
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('refuses a write without the CSRF token or from another origin, before anything is written', async () => {
    expect(errorOf(await me.client.post('/api/v1/account/messages', { body: 'Hello.' }, { noCsrf: true })).code).toBe('CSRF_FAILED');
    expect((await me.client.post('/api/v1/account/messages', { body: 'Hello.' }, { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await me.client.post('/api/v1/account/messages/read', { upTo: new Date().toISOString() }, { noCsrf: true })).statusCode).toBe(403);
    const res = await me.client.get('/api/v1/account/messages');
    expect(safeJson(res)).toEqual({ messages: [], unread: false });
  });

  it('writes with each context and returns where it is in the app; a scan has no link', async () => {
    const piece = await me.client.post('/api/v1/account/messages', { body: 'About my piece.', context: { kind: 'PIECE', id: serial } });
    expect(piece.statusCode, piece.body).toBe(201);
    expect(piece.headers['cache-control']).toBe('no-store');
    const m = (safeJson(piece) as { message: MessageJson }).message;
    expect(m).toEqual({ id: expect.any(String), from: 'YOU', body: 'About my piece.', at: expect.any(String), concerning: { kind: 'PIECE', label: `MONOLITHE · ${serial}`, path: `/verify/pieces/${serial}` } });
    const scan = await me.client.post('/api/v1/account/messages', { body: 'About this scan.', context: { kind: 'SCAN', id: scanId, about: 'WARRANTY' } });
    expect(scan.statusCode, scan.body).toBe(201);
    expect((safeJson(scan) as { message: MessageJson }).message.concerning).toMatchObject({ kind: 'SCAN', path: null, label: expect.stringMatching(/^REF [0-9A-F]{8} · .* · WARRANTY NO LONGER VALID$/) });
    // ORDER, RELEASE and MODEL paths: MY PIECES' ORDERS tab, the release's page, the model's sheet by its slug.
    const slug = 'monolithe-msg';
    await h.ctx.db.updateTable('models').set({ slug, lookbook: 'PUBLIC' }).where('id', '=', catalog.modelId).execute();
    const model = await me.client.post('/api/v1/account/messages', { body: 'This model.', context: { kind: 'MODEL', id: catalog.modelId } });
    expect((safeJson(model) as { message: MessageJson }).message.concerning).toEqual({ kind: 'MODEL', label: 'MONOLITHE', path: `/verify/lookbook/${slug}` });
    const admin = await h.ctx.db.selectFrom('admin_users').select('id').where('role', '=', 'OPERATOR').executeTakeFirstOrThrow();
    const draw = await poolDraw(
      h.ctx.services.drops,
      h.ctx.db,
      { modelId: catalog.modelId, title: 'Monolithe in steel', quantity: 3, opensAt: new Date(h.clock.now().getTime() + 3_600_000), closesAt: new Date(h.clock.now().getTime() + 7_200_000), earlyAccessHours: 0 },
      { type: 'admin', id: admin.id },
    );
    const release = await me.client.post('/api/v1/account/messages', { body: 'This release.', context: { kind: 'RELEASE', id: draw.id } });
    expect((safeJson(release) as { message: MessageJson }).message.concerning).toEqual({ kind: 'RELEASE', label: 'MONOLITHE IN STEEL', path: `/verify/releases/${draw.id}` });
    // Refused contexts and words, as the server writes them.
    const refused = await me.client.post('/api/v1/account/messages', { body: 'Hello.', context: { kind: 'ORDER', id: '00000000-0000-4000-8000-000000000000' } });
    expect(refused.statusCode).toBe(422);
    expect(errorOf(refused)).toEqual({ code: 'MESSAGE_CONTEXT_INVALID', message: 'This cannot be attached to your message.' });
    expect(errorOf(await me.client.post('/api/v1/account/messages', { body: '' }))).toEqual({ code: 'VALIDATION_FAILED', message: 'Write your message.' });
    expect(errorOf(await me.client.post('/api/v1/account/messages', { body: 'x'.repeat(2001) }))).toEqual({ code: 'VALIDATION_FAILED', message: 'Your message is limited to 2,000 characters.' });
    expect((await me.client.post('/api/v1/account/messages', { body: 'Hi.', context: { kind: 'PIECE', id: serial, extra: 1 } })).statusCode).toBe(400);
  });

  it('reads the thread with the answers signed ORBES Client Services, marks them read, and never names staff', async () => {
    const conversation = await h.ctx.db
      .selectFrom('client_conversations as c')
      .innerJoin('accounts as a', 'a.id', 'c.account_id')
      .select('c.id')
      .where('a.email_normalized', '=', me.email.toLowerCase())
      .executeTakeFirstOrThrow();
    h.clock.advance(60_000);
    expect((await operator.post(`/api/admin/messages/${conversation.id}/answer`, { body: 'Our answer.' })).statusCode).toBe(200);
    const unread = await me.client.get('/api/v1/account/messages/unread');
    expect(unread.headers['cache-control']).toBe('no-store');
    expect(safeJson(unread)).toEqual({ unread: true });
    const res = await me.client.get('/api/v1/account/messages');
    expect(res.headers['cache-control']).toBe('no-store');
    const thread = safeJson(res) as { messages: MessageJson[]; unread: boolean };
    expect(thread.unread).toBe(true);
    const answer = thread.messages.at(-1)!;
    expect(answer).toEqual({ id: expect.any(String), from: 'ORBES_CLIENT_SERVICES', body: 'Our answer.', at: expect.any(String), concerning: null });
    expect(res.body).not.toMatch(/@orbes\.test|TO_ANSWER|ANSWERED|CLOSED|adminId|admin_id/);
    const read = await me.client.post('/api/v1/account/messages/read', { upTo: answer.at });
    expect(read.statusCode).toBe(204);
    expect(safeJson(await me.client.get('/api/v1/account/messages/unread'))).toEqual({ unread: false });
    expect((await me.client.post('/api/v1/account/messages/read', { upTo: 'yesterday' })).statusCode).toBe(400);
  });
});
