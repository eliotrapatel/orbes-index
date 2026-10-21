/**
 * MESSAGES for the collector (plan NEXT-NINE of 2026-10-06, §3.1 CS-01; API §10.17): 401 signed out, the CSRF token and
 * the same origin on every write, `no-store` on every answer, the shapes (each context kind's `path`, a scan's null, and
 * the thread's `ref`, the id a reply attaches again), the answers unread counted for the account alone (`unread-count`,
 * a computer's account page), and staff never named to the collector.
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
  concerning: { kind: string; label: string; path: string | null; ref?: string | null } | null;
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
      ['GET', '/api/v1/account/messages/unread-count'],
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
    // The thread gives each the id a reply attaches again (`ref`): the piece's serial, the scan's, the model's and the
    // release's id, as the collector sent them.
    const thread = safeJson(await me.client.get('/api/v1/account/messages')) as { messages: MessageJson[] };
    expect(thread.messages.map((m) => [m.concerning?.kind, m.concerning?.ref])).toEqual([
      ['PIECE', serial],
      ['SCAN', scanId],
      ['MODEL', catalog.modelId],
      ['RELEASE', draw.id],
    ]);
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
    expect(safeJson(unread)).toEqual({ unread: true, house: false });
    // How many: one answer; another account reads its own count, never this one's.
    const count = await me.client.get('/api/v1/account/messages/unread-count');
    expect(count.statusCode).toBe(200);
    expect(count.headers['cache-control']).toBe('no-store');
    expect(safeJson(count)).toEqual({ count: 1 });
    const stranger = await accountClient(h);
    expect(safeJson(await stranger.client.get('/api/v1/account/messages/unread-count'))).toEqual({ count: 0 });
    const res = await me.client.get('/api/v1/account/messages');
    expect(res.headers['cache-control']).toBe('no-store');
    const thread = safeJson(res) as { messages: MessageJson[]; unread: boolean };
    expect(thread.unread).toBe(true);
    const answer = thread.messages.at(-1)!;
    expect(answer).toEqual({ id: expect.any(String), from: 'ORBES_CLIENT_SERVICES', body: 'Our answer.', at: expect.any(String), concerning: null });
    expect(res.body).not.toMatch(/@orbes\.test|TO_ANSWER|ANSWERED|CLOSED|adminId|admin_id/);
    const read = await me.client.post('/api/v1/account/messages/read', { upTo: answer.at });
    expect(read.statusCode).toBe(204);
    expect(safeJson(await me.client.get('/api/v1/account/messages/unread'))).toEqual({ unread: false, house: false });
    expect(safeJson(await me.client.get('/api/v1/account/messages/unread-count'))).toEqual({ count: 0 });
    expect((await me.client.post('/api/v1/account/messages/read', { upTo: 'yesterday' })).statusCode).toBe(400);
  });
});

describe('house messages for the collector (plan MACRO M2 §1.4, D24 M3 and M4)', () => {
  let h: Harness;
  let catalog: Catalog;
  let me: { client: Client; email: string };
  let meId: string;
  let serial: string;
  let admin: Client;

  interface HouseJson {
    id: string;
    source: 'MOMENT' | 'CUSTOM';
    moment: string | null;
    title: string;
    body: string;
    pieceRef: string | null;
    pieceHeld: boolean | null;
    at: string;
    unread: boolean;
  }

  beforeAll(async () => {
    h = await createHarness();
    catalog = await seedCatalog(h.ctx);
    me = await accountClient(h);
    admin = await adminClient(h, 'ADMIN');
    meId = (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', me.email.toLowerCase()).executeTakeFirstOrThrow()).id;
    const p = await issue(h.ctx, catalog);
    await h.ctx.services.warranty.activate(p.product.productId, { retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    const scan = safeJson(await me.client.post('/api/v1/verify', { code: p.code.data })) as { registration: { token: string } };
    expect((await me.client.post('/api/v1/ownership/register', { registrationToken: scan.registration.token })).statusCode).toBe(201);
    serial = p.product.productId;
  });
  afterAll(() => h?.close());

  const at = (minutes: number) => new Date(h.clock.now().getTime() - minutes * 60_000);

  it('answers 401 signed out, and refuses a read without the CSRF token or from another origin', async () => {
    const anon = h.client();
    expect((await anon.get('/api/v1/account/house-messages')).statusCode).toBe(401);
    expect((await anon.post('/api/v1/account/house-messages/read', { upTo: new Date().toISOString() })).statusCode).toBe(401);
    expect(errorOf(await me.client.post('/api/v1/account/house-messages/read', { upTo: new Date().toISOString() }, { noCsrf: true })).code).toBe('CSRF_FAILED');
    expect((await me.client.post('/api/v1/account/house-messages/read', { upTo: new Date().toISOString() }, { origin: 'https://evil.example' })).statusCode).toBe(403);
    const empty = await me.client.get('/api/v1/account/house-messages');
    expect(empty.headers['cache-control']).toBe('no-store');
    expect(safeJson(empty)).toEqual({ messages: [], unread: 0, total: 0 });
    expect(safeJson(await me.client.get('/api/v1/account/messages/unread'))).toEqual({ unread: false, house: false });
    expect(safeJson(await me.client.get('/api/v1/account/messages/unread-count'))).toEqual({ count: 0 });
  });

  it('lists a moment with its piece and a custom message with the first name filled, newest first; flags and counts them unread; reads them up to a time', async () => {
    const staff = (await h.ctx.db.selectFrom('admin_users').select('id').where('role', '=', 'ADMIN').executeTakeFirstOrThrow()).id;
    await h.ctx.db
      .insertInto('house_deliveries')
      .values({ account_id: meId, source: 'MOMENT', moment: 'FIRST_REGISTRATION', title: 'YOUR FIRST PIECE', body: 'MONOLITHE is registered to you.\n\nIts care.', piece_ref: serial, dedupe_key: `FIRST_REGISTRATION:${meId}`, delivered_at: at(10) })
      .execute();
    const custom = await h.ctx.db
      .insertInto('house_messages')
      .values({ title: 'FOR {firstName}', body: 'Dear {firstName},\n\nA word from ORBES.', status: 'SENT', audience_min_tier: 1, audience_label: 'TITANE', send_at: at(5), sent_at: at(5), reach: 1, sent_by: staff, created_by: staff, updated_by: staff })
      .returning('id')
      .executeTakeFirstOrThrow();
    await h.ctx.db.insertInto('house_deliveries').values({ account_id: meId, source: 'CUSTOM', house_message_id: custom.id, dedupe_key: `CUSTOM:${custom.id}:${meId}`, delivered_at: at(5) }).execute();
    // Another account's message never shows here.
    const other = await accountClient(h);
    const otherId = (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', other.email.toLowerCase()).executeTakeFirstOrThrow()).id;
    await h.ctx.db.insertInto('house_deliveries').values({ account_id: otherId, source: 'MOMENT', moment: 'NINETY_DAYS', title: 'WHAT IS NEW', body: 'Theirs.', dedupe_key: `NINETY_DAYS:${otherId}:2026-01-01`, delivered_at: at(1) }).execute();

    const page = safeJson(await me.client.get('/api/v1/account/house-messages')) as { messages: HouseJson[]; unread: number; total: number };
    expect(page.unread).toBe(2);
    expect(page.total).toBe(2);
    expect(page.messages).toEqual([
      { id: expect.any(String), source: 'CUSTOM', moment: null, title: 'FOR Owner', body: 'Dear Owner,\n\nA word from ORBES.', pieceRef: null, pieceHeld: null, at: at(5).toISOString(), unread: true },
      { id: expect.any(String), source: 'MOMENT', moment: 'FIRST_REGISTRATION', title: 'YOUR FIRST PIECE', body: 'MONOLITHE is registered to you.\n\nIts care.', pieceRef: serial, pieceHeld: true, at: at(10).toISOString(), unread: true },
    ]);
    expect(JSON.stringify(page)).not.toMatch(/Theirs|audience|TITANE|sent_by|reach|dedupe/);
    expect(safeJson(await me.client.get('/api/v1/account/messages/unread'))).toEqual({ unread: false, house: true });
    expect(safeJson(await me.client.get('/api/v1/account/messages/unread-count'))).toEqual({ count: 2 });
    // Read up to the first: the second stays unread; a time ahead reads no later than now.
    expect((await me.client.post('/api/v1/account/house-messages/read', { upTo: at(10).toISOString() })).statusCode).toBe(204);
    expect(((safeJson(await me.client.get('/api/v1/account/house-messages')) as { messages: HouseJson[] }).messages.map((m) => m.unread))).toEqual([true, false]);
    expect(safeJson(await me.client.get('/api/v1/account/messages/unread-count'))).toEqual({ count: 1 });
    expect((await me.client.post('/api/v1/account/house-messages/read', { upTo: new Date(h.clock.now().getTime() + 86_400_000).toISOString() })).statusCode).toBe(204);
    const read = await h.ctx.db.selectFrom('house_deliveries').select(['read_at']).where('account_id', '=', meId).orderBy('delivered_at').execute();
    expect(read.map((r) => r.read_at)).toEqual([at(10), h.clock.now()]);
    expect(safeJson(await me.client.get('/api/v1/account/messages/unread'))).toEqual({ unread: false, house: false });
    expect(safeJson(await me.client.get('/api/v1/account/messages/unread-count'))).toEqual({ count: 0 });
    expect(safeJson(await other.client.get('/api/v1/account/messages/unread-count'))).toEqual({ count: 1 });
    expect((await me.client.post('/api/v1/account/house-messages/read', { upTo: 'yesterday' })).statusCode).toBe(400);
  });

  it('pages them 30 at a time, newest first; anything unreadable is page 1', async () => {
    for (let i = 0; i < 30; i++) {
      await h.ctx.db.insertInto('house_deliveries').values({ account_id: meId, source: 'MOMENT', moment: 'NINETY_DAYS', title: `WHAT IS NEW ${i}`, body: 'Words.', dedupe_key: `NINETY_DAYS:${meId}:page-${i}`, delivered_at: at(4 - i / 100) }).execute();
    }
    const first = safeJson(await me.client.get('/api/v1/account/house-messages')) as { messages: HouseJson[]; unread: number; total: number };
    expect([first.messages.length, first.total, first.unread]).toEqual([30, 32, 30]);
    expect(first.messages[0]!.title).toBe('WHAT IS NEW 29');
    const second = safeJson(await me.client.get('/api/v1/account/house-messages?page=2')) as { messages: HouseJson[] };
    expect(second.messages.map((m) => m.title)).toEqual(['FOR Owner', 'YOUR FIRST PIECE']);
    expect((safeJson(await me.client.get('/api/v1/account/house-messages?page=nope')) as { messages: HouseJson[] }).messages[0]!.title).toBe('WHAT IS NEW 29');
    expect((safeJson(await me.client.get('/api/v1/account/house-messages?page=9')) as { messages: HouseJson[] }).messages).toEqual([]);
  });

  it('gives them in the account’s export, oldest first, as read, with when each was delivered and read', async () => {
    const res = await admin.get(`/api/admin/owners/${meId}/export`);
    expect(res.statusCode).toBe(200);
    const x = safeJson(res) as { houseMessages: { source: string; moment: string | null; title: string; body: string; pieceRef: string | null; deliveredAt: string; readAt: string | null }[] };
    expect(x.houseMessages).toHaveLength(32);
    expect(x.houseMessages.slice(0, 2)).toEqual([
      { source: 'MOMENT', moment: 'FIRST_REGISTRATION', title: 'YOUR FIRST PIECE', body: 'MONOLITHE is registered to you.\n\nIts care.', pieceRef: serial, deliveredAt: expect.any(String), readAt: expect.any(String) },
      { source: 'CUSTOM', moment: null, title: 'FOR Owner', body: 'Dear Owner,\n\nA word from ORBES.', pieceRef: null, deliveredAt: expect.any(String), readAt: expect.any(String) },
    ]);
    const audit = await h.ctx.db.selectFrom('audit_logs').select('details').where('action', '=', 'account.export').where('target_id', '=', meId).executeTakeFirstOrThrow();
    expect(audit.details).toMatchObject({ houseMessages: 32 });
  });
});
