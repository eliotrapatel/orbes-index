/**
 * The Messages board of the console (plan NEXT-NINE of 2026-10-06, §3.1 CS-01; API §16.28), by role: an AUDITOR reads
 * with the clients' emails masked and searches by the whole email only; an OPERATOR answers, takes and closes; only an
 * ADMIN assigns; RETAIL reaches nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountClient, adminClient, createAdmin, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

interface RowJson {
  id: string;
  account: { id: string; email: string };
  status: string;
  priority: string | null;
  answeredBy: { id: string; email: string } | null;
  lastMessage: { author: string; excerpt: string };
}

describe('the Messages board by role (CS-01)', () => {
  let h: Harness;
  let collector: { client: Client; email: string };
  let auditor: Client;
  let operator: Client;
  let admin: Client;
  let retail: Client;
  let conversation: string;

  beforeAll(async () => {
    h = await createHarness();
    collector = await accountClient(h);
    auditor = await adminClient(h, 'AUDITOR');
    operator = await adminClient(h, 'OPERATOR');
    admin = await adminClient(h, 'ADMIN');
    retail = await adminClient(h, 'RETAIL');
    expect((await collector.client.post('/api/v1/account/messages', { body: 'A question about my ring.' })).statusCode).toBe(201);
    conversation = (await h.ctx.db.selectFrom('client_conversations').select('id').executeTakeFirstOrThrow()).id;
  });
  afterAll(() => h?.close());

  it('lets an AUDITOR read the board, the badge and the conversation, the client\'s email masked, and refuses its writes', async () => {
    const board = await auditor.get('/api/admin/messages');
    expect(board.statusCode).toBe(200);
    const page = safeJson(board) as { items: RowJson[]; total: number; toAnswer: number };
    expect(page.toAnswer).toBe(1);
    expect(page.items[0]).toMatchObject({ id: conversation, status: 'TO_ANSWER', priority: null, answeredBy: null, lastMessage: { author: 'COLLECTOR', excerpt: 'A question about my ring.' } });
    expect(page.items[0]!.account.email).toMatch(/^o\*\*\*@example\.com$/);
    expect(safeJson(await auditor.get('/api/admin/messages/summary'))).toEqual({ toAnswer: 1, priority: 0 });
    const one = safeJson(await auditor.get(`/api/admin/messages/${conversation}`)) as RowJson & { messages: { body: string }[] };
    expect(one.account.email).not.toBe(collector.email);
    expect(one.messages.map((m) => m.body)).toEqual(['A question about my ring.']);
    for (const url of ['answer', 'take', 'close']) {
      const res = await auditor.post(`/api/admin/messages/${conversation}/${url}`, url === 'answer' ? { body: 'No.' } : undefined);
      expect(res.statusCode, url).toBe(403);
      expect(errorOf(res).code).toBe('FORBIDDEN');
    }
  });

  it('lets an AUDITOR search by the whole email only, never part of it; an OPERATOR by part of it', async () => {
    const ids = async (c: Client, q: string) => ((safeJson(await c.get(`/api/admin/messages?status=ALL&q=${encodeURIComponent(q)}`)) as { items: RowJson[] }).items).map((r) => r.id);
    const prefix = collector.email.slice(0, 3);
    // Part of the email: no row for the AUDITOR (it would rebuild the address a character at a time).
    for (const q of [prefix, collector.email.slice(0, -1), '@example.com']) expect(await ids(auditor, q), q).toEqual([]);
    // The whole email, in any case: the row, its email still masked.
    const whole = safeJson(await auditor.get(`/api/admin/messages?status=ALL&q=${encodeURIComponent(collector.email.toUpperCase())}`)) as { items: RowJson[] };
    expect(whole.items.map((r) => r.id)).toEqual([conversation]);
    expect(whole.items[0]!.account.email).toMatch(/^o\*\*\*@example\.com$/);
    // An OPERATOR reads the emails in clear: part of one finds it.
    expect(await ids(operator, prefix)).toEqual([conversation]);
  });

  it('lets an OPERATOR read the email in clear, answer, take and close; only an ADMIN assigns', async () => {
    const page = safeJson(await operator.get('/api/admin/messages')) as { items: RowJson[] };
    expect(page.items[0]!.account.email).toBe(collector.email);
    const answered = await operator.post(`/api/admin/messages/${conversation}/answer`, { body: 'Our answer.' });
    expect(answered.statusCode, answered.body).toBe(200);
    expect(safeJson(answered)).toMatchObject({ status: 'ANSWERED', answeredBy: { email: expect.stringMatching(/^operator-/) } });
    expect((await operator.post(`/api/admin/messages/${conversation}/take`)).statusCode).toBe(200);
    const other = await createAdmin(h.ctx, 'OPERATOR');
    const refused = await operator.post(`/api/admin/messages/${conversation}/assign`, { adminId: other.id });
    expect(refused.statusCode).toBe(403);
    const assigned = await admin.post(`/api/admin/messages/${conversation}/assign`, { adminId: other.id });
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect(safeJson(assigned)).toMatchObject({ answeredBy: { id: other.id, email: other.email } });
    expect((await operator.post(`/api/admin/messages/${conversation}/close`)).statusCode).toBe(200);
    expect(errorOf(await operator.post(`/api/admin/messages/${conversation}/close`)).code).toBe('CONVERSATION_CLOSED');
    // Without the CSRF header, refused even for an OPERATOR; an unknown conversation is never opened.
    expect((await operator.post(`/api/admin/messages/${conversation}/answer`, { body: 'Hi.' }, { noCsrf: true })).statusCode).toBe(403);
    const unknown = await operator.post('/api/admin/messages/00000000-0000-4000-8000-000000000000/answer', { body: 'Hi.' });
    expect(unknown.statusCode).toBe(404);
    expect(errorOf(unknown).code).toBe('CONVERSATION_NOT_FOUND');
    // The client writes again: it reopens, To answer.
    expect((await collector.client.post('/api/v1/account/messages', { body: 'One more thing.' })).statusCode).toBe(201);
    expect(safeJson(await operator.get('/api/admin/messages/summary'))).toEqual({ toAnswer: 1, priority: 0 });
  });

  it('refuses RETAIL everywhere', async () => {
    for (const [method, url] of [
      ['GET', '/api/admin/messages'],
      ['GET', '/api/admin/messages/summary'],
      ['GET', `/api/admin/messages/${conversation}`],
      ['POST', `/api/admin/messages/${conversation}/answer`],
      ['POST', `/api/admin/messages/${conversation}/take`],
      ['POST', `/api/admin/messages/${conversation}/assign`],
      ['POST', `/api/admin/messages/${conversation}/close`],
    ] as const) {
      const res = await retail.request(method, url, method === 'POST' ? { body: {} } : {});
      expect(res.statusCode, url).toBe(403);
    }
  });
});
