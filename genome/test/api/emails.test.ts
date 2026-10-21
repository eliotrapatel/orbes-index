/**
 * The emails' routes (lot M1 plan §4.2, §4.5; step M1.17), on PGlite, the channel off (production's default) and on (an
 * SMTP channel no test reaches: the outbox is read back, nothing is sent):
 *  - E3, RESET BY EMAIL: GET /api/v1/account/reset says whether it is offered; POST /api/v1/account/reset-request answers
 *    409 EMAIL_OFF while it is not, then 202 for any address; an ACTIVE account's code issued `EMAIL` by no one and sent
 *    as a link with the code in the fragment, entered through the existing /recover; at most 3 an hour; a LOCKED account
 *    and a test entrant get nothing; Client Services' path unchanged;
 *  - E2, YOUR PROFILE: GET and PUT /api/v1/account/email-preferences (409 EMAIL_OFF while off, signed in only);
 *  - unsubscribe: GET reads a token's kind, POST stops it, from the page (JSON) or a mail client's one click (a form, any
 *    origin, no cookie), the same answer for any token;
 *  - the console's routes: roles, the words, the switch, the preview, a test to oneself (409 EMAIL_OFF while off), the
 *    outbox with addresses masked for an AUDITOR and a reset link's code or an unsubscribe token never shown, the founding
 *    announcement.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmailConfig } from '../../src/server/config.js';
import { RESET_REQUEST_LIMIT } from '../../src/server/services/account-recovery.js';
import { adminClient, accountClient, createHarness, errorOf, ORIGIN, PASSWORD, safeJson, type Harness } from './support.js';

const ON: EmailConfig = {
  transport: 'smtp',
  from: { address: 'hello@theorbes.com', name: 'ORBES' },
  replyTo: null,
  smtp: { host: 'smtp.invalid', port: 465, security: 'tls', user: 'u', password: 'p' },
};
const NEW_PASSWORD = 'a brand new passphrase';

describe('the emails’ routes while the channel is off (the default)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  it('offers no reset by email, refuses its request and YOUR PROFILE’s choice with 409 EMAIL_OFF, and the console says OFF', async () => {
    const anon = h.client();
    const reset = await anon.get('/api/v1/account/reset');
    expect(reset.statusCode).toBe(200);
    expect(reset.headers['cache-control']).toBe('no-store');
    expect(safeJson(reset)).toEqual({ email: false });
    const asked = await anon.post('/api/v1/account/reset-request', { email: 'nobody@example.com' });
    expect(asked.statusCode).toBe(409);
    expect(errorOf(asked).code).toBe('EMAIL_OFF');
    const { client } = await accountClient(h);
    for (const res of [await client.get('/api/v1/account/email-preferences'), await client.request('PUT', '/api/v1/account/email-preferences', { body: { releaseNotices: true } })]) {
      expect(res.statusCode).toBe(409);
      expect(errorOf(res).code).toBe('EMAIL_OFF');
    }
    const admin = await adminClient(h, 'ADMIN');
    const page = safeJson(await admin.get('/api/admin/email')) as { channel: unknown; kinds: { kind: string; enabled: boolean }[]; outbox: { queued: number } };
    expect(page.channel).toEqual({ on: false });
    expect(page.kinds).toHaveLength(11);
    expect(page.kinds.every((k) => !k.enabled)).toBe(true);
    const test = await admin.post('/api/admin/email/kinds/ORDER_CONFIRMED/test', {});
    expect(test.statusCode).toBe(409);
    expect(errorOf(test).code).toBe('EMAIL_OFF');
    expect(await h.ctx.db.selectFrom('email_outbox').select('id').execute()).toEqual([]);
  });
});

describe('the emails’ routes while the channel is on', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({ config: { email: ON } });
  });
  afterAll(() => h.close());

  const outbox = (kind?: string) =>
    h.ctx.db
      .selectFrom('email_outbox')
      .selectAll()
      .$if(kind !== undefined, (q) => q.where('kind', '=', kind as 'PASSWORD_RESET'))
      .orderBy('created_at')
      .execute();
  /** The code and the address a reset email carries, read from its link (…/verify/reset#<email>/<code>). */
  const linkOf = (text: string) => {
    const m = /\/verify\/reset#([^/\s]+)\/([0-9A-Z-]{14})/.exec(text);
    if (!m) throw new Error('no reset link');
    return { email: decodeURIComponent(m[1]!), code: m[2]! };
  };

  it('E3: offered once PASSWORD_RESET is on; the same 202 for any address; the code sent as a link in the fragment, entered through /recover', async () => {
    const anon = h.client({ ip: '198.51.100.21' });
    expect(safeJson(await anon.get('/api/v1/account/reset'))).toEqual({ email: false });
    expect(errorOf(await anon.post('/api/v1/account/reset-request', { email: 'x@example.com' })).code).toBe('EMAIL_OFF');
    const admin = await adminClient(h, 'ADMIN');
    expect((await admin.request('PUT', '/api/admin/email/kinds/PASSWORD_RESET/enabled', { body: { enabled: true } })).statusCode).toBe(200);
    expect(safeJson(await anon.get('/api/v1/account/reset'))).toEqual({ email: true });

    const { client, email } = await accountClient(h);
    const unknown = await anon.post('/api/v1/account/reset-request', { email: 'nobody-here@example.com' });
    expect(unknown.statusCode).toBe(202);
    expect(safeJson(unknown)).toEqual({ ok: true });
    const known = await anon.post('/api/v1/account/reset-request', { email: email.toUpperCase() });
    expect(known.statusCode).toBe(202);
    expect(known.body).toBe(unknown.body);
    const rows = await outbox('PASSWORD_RESET');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.to_address).toBe(email);
    const link = linkOf(rows[0]!.body_text);
    expect(link.email).toBe(email);
    expect(rows[0]!.body_text).toContain(`${ORIGIN}/verify/reset#${encodeURIComponent(email)}/${link.code}`);
    const account = await h.ctx.db.selectFrom('accounts').select('id').where('email', '=', email).executeTakeFirstOrThrow();
    const code = await h.ctx.db.selectFrom('account_recovery_codes').selectAll().where('account_id', '=', account.id).executeTakeFirstOrThrow();
    expect(code).toMatchObject({ issued_via: 'EMAIL', created_by: null, used_at: null, revoked_at: null });
    const audit = await h.ctx.db.selectFrom('audit_logs').select(['details', 'actor_type']).where('action', '=', 'account.recovery_code.request').execute();
    expect(audit).toEqual([{ actor_type: 'account', details: expect.objectContaining({ recoveryCodeId: code.id, via: 'EMAIL', replaced: 0 }) }]);
    expect(JSON.stringify(audit)).not.toContain(link.code);
    expect(JSON.stringify(audit)).not.toContain(email);

    // The link's code sets a new password through the existing route; the sessions end, the old password no longer works.
    const recovered = await anon.post('/api/v1/account/recover', { email: link.email, recoveryCode: link.code, newPassword: NEW_PASSWORD });
    expect(recovered.statusCode).toBe(200);
    expect((await client.get('/api/v1/account/me')).statusCode).toBe(401);
    expect((await h.client().post('/api/v1/account/login', { email, password: NEW_PASSWORD })).statusCode).toBe(200);
    expect((await h.client().post('/api/v1/account/login', { email, password: PASSWORD })).statusCode).toBe(401);
    // Used once.
    expect(errorOf(await anon.post('/api/v1/account/recover', { email: link.email, recoveryCode: link.code, newPassword: `${NEW_PASSWORD} again` })).code).toBe('RECOVERY_CODE_INVALID');
  });

  it('E3: at most 3 an hour per account; a new one revokes the open one; a LOCKED account and a test entrant get nothing; Client Services’ code still works', async () => {
    const anon = h.client({ ip: '198.51.100.22' });
    const { email } = await accountClient(h);
    const account = await h.ctx.db.selectFrom('accounts').select('id').where('email', '=', email).executeTakeFirstOrThrow();
    const before = (await outbox('PASSWORD_RESET')).length;
    for (let i = 0; i < RESET_REQUEST_LIMIT + 1; i++) {
      expect((await anon.post('/api/v1/account/reset-request', { email })).statusCode).toBe(202);
      h.clock.advance(60_000);
    }
    expect((await outbox('PASSWORD_RESET')).length - before).toBe(RESET_REQUEST_LIMIT);
    const codes = await h.ctx.db.selectFrom('account_recovery_codes').select(['revoked_at', 'issued_via']).where('account_id', '=', account.id).orderBy('created_at').execute();
    expect(codes.map((c) => [c.issued_via, c.revoked_at === null])).toEqual([
      ['EMAIL', false],
      ['EMAIL', false],
      ['EMAIL', true],
    ]);
    // An hour later, again.
    h.clock.advance(60 * 60_000);
    await anon.post('/api/v1/account/reset-request', { email });
    expect((await outbox('PASSWORD_RESET')).length - before).toBe(RESET_REQUEST_LIMIT + 1);

    // Client Services' assisted recovery is unchanged: its code (STAFF) replaces the emailed one and works.
    const cs = await adminClient(h, 'ADMIN');
    const issued = safeJson(await cs.post(`/api/admin/owners/${account.id}/recovery-code`)) as { recoveryCode: string };
    expect(issued.recoveryCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect((await h.ctx.db.selectFrom('account_recovery_codes').select('issued_via').where('account_id', '=', account.id).where('revoked_at', 'is', null).where('used_at', 'is', null).execute()).map((c) => c.issued_via)).toEqual(['STAFF']);
    expect((await anon.post('/api/v1/account/recover', { email, recoveryCode: issued.recoveryCode, newPassword: NEW_PASSWORD })).statusCode).toBe(200);

    // Locked: nothing. A test entrant: nothing.
    const locked = await accountClient(h);
    const lockedId = (await h.ctx.db.selectFrom('accounts').select('id').where('email', '=', locked.email).executeTakeFirstOrThrow()).id;
    expect((await cs.post(`/api/admin/owners/${lockedId}/lock`)).statusCode).toBe(200);
    const bot = await accountClient(h);
    const botId = (await h.ctx.db.selectFrom('accounts').select('id').where('email', '=', bot.email).executeTakeFirstOrThrow()).id;
    await h.ctx.db.insertInto('test_entrants').values({ account_id: botId }).execute();
    const count = (await outbox('PASSWORD_RESET')).length;
    for (const e of [locked.email, bot.email]) expect((await anon.post('/api/v1/account/reset-request', { email: e })).statusCode).toBe(202);
    expect((await outbox('PASSWORD_RESET')).length).toBe(count);
  });

  it('E2: YOUR PROFILE’s release notices, signed in only, off until asked', async () => {
    expect((await h.client().get('/api/v1/account/email-preferences')).statusCode).toBe(401);
    const { client } = await accountClient(h);
    const read = await client.get('/api/v1/account/email-preferences');
    expect(read.statusCode).toBe(200);
    expect(read.headers['cache-control']).toBe('no-store');
    expect(safeJson(read)).toEqual({ releaseNotices: false, changedAt: null });
    const set = await client.request('PUT', '/api/v1/account/email-preferences', { body: { releaseNotices: true } });
    expect(set.statusCode).toBe(200);
    expect(safeJson(set)).toEqual({ releaseNotices: true, changedAt: h.clock.now().toISOString() });
    expect(safeJson(await client.get('/api/v1/account/email-preferences'))).toMatchObject({ releaseNotices: true });
    expect((await client.request('PUT', '/api/v1/account/email-preferences', { body: { releaseNotices: 'yes' } })).statusCode).toBe(400);
    expect((await client.request('PUT', '/api/v1/account/email-preferences', { body: { releaseNotices: false }, noCsrf: true })).statusCode).toBe(403);
  });

  it('unsubscribe: GET names what a token stops; POST stops it from the page or a mail client’s one click, the same answer for any token', async () => {
    const { client, email } = await accountClient(h);
    const id = (await h.ctx.db.selectFrom('accounts').select('id').where('email', '=', email).executeTakeFirstOrThrow()).id;
    await client.request('PUT', '/api/v1/account/email-preferences', { body: { releaseNotices: true } });
    const token = h.ctx.services.email.unsubscribeToken('RELEASE_NOTICE', id);
    const anon = h.client({ origin: null });
    const kind = await anon.get(`/api/v1/email/unsubscribe?t=${token}`);
    expect(kind.headers['cache-control']).toBe('no-store');
    expect(safeJson(kind)).toEqual({ kind: 'RELEASE_NOTICE' });
    expect(safeJson(await anon.get('/api/v1/email/unsubscribe?t=forged'))).toEqual({ kind: null });
    expect(safeJson(await anon.get('/api/v1/email/unsubscribe'))).toEqual({ kind: null });

    // A forged token and a real one answer alike.
    const forged = await anon.post('/api/v1/email/unsubscribe', { token: `${token.slice(0, -3)}AAA` });
    const page = await h.client().post('/api/v1/email/unsubscribe', { token });
    expect([forged.statusCode, page.statusCode]).toEqual([200, 200]);
    expect(forged.body).toBe(page.body);
    expect(safeJson(await client.get('/api/v1/account/email-preferences'))).toMatchObject({ releaseNotices: false });

    // A mail client's one click (RFC 8058): another origin, no cookie, a form body, the token in the address.
    await client.request('PUT', '/api/v1/account/email-preferences', { body: { releaseNotices: true } });
    const mailClient = h.client({ origin: 'https://mail.example.com' });
    const oneClick = await mailClient.request('POST', `/api/v1/email/unsubscribe?t=${token}`, { body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(oneClick.statusCode).toBe(200);
    expect(safeJson(oneClick)).toEqual({ ok: true });
    expect(safeJson(await client.get('/api/v1/account/email-preferences'))).toMatchObject({ releaseNotices: false });
    expect((await mailClient.request('POST', '/api/v1/email/unsubscribe?t=nonsense', { body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).statusCode).toBe(200);
  });

  it('the console: the words (OPERATOR), the switch (ADMIN), the preview, a test to oneself, the outbox masked for an AUDITOR, a reset link’s code never shown', async () => {
    const admin = await adminClient(h, 'ADMIN');
    const operator = await adminClient(h, 'OPERATOR');
    const auditor = await adminClient(h, 'AUDITOR');
    const page = safeJson(await auditor.get('/api/admin/email')) as {
      channel: unknown;
      kinds: { kind: string; enabled: boolean; edited: { subject: boolean; body: boolean }; placeholders: { name: string; words: string }[]; defaults: { subject: string } }[];
    };
    expect(page.channel).toEqual({ on: true, host: 'smtp.invalid', from: 'hello@theorbes.com' });
    const shipped = page.kinds.find((k) => k.kind === 'ORDER_SHIPPED')!;
    expect(shipped.placeholders.map((p) => p.name)).toEqual(['firstName', 'orderRef', 'carrier', 'trackingUrl', 'link']);
    expect(shipped.defaults.subject).toBe('Your order {orderRef} is on its way');

    expect((await operator.request('PUT', '/api/admin/email/kinds/ORDER_SHIPPED/enabled', { body: { enabled: true } })).statusCode).toBe(403);
    const words = await operator.request('PUT', '/api/admin/email/kinds/ORDER_SHIPPED/words', { body: { subject: 'On its way: {orderRef}' } });
    expect(words.statusCode).toBe(200);
    expect((safeJson(words) as { kind: { words: { subject: string }; edited: { subject: boolean; body: boolean } } }).kind).toMatchObject({ words: { subject: 'On its way: {orderRef}' }, edited: { subject: true, body: false } });
    expect(errorOf(await operator.request('PUT', '/api/admin/email/kinds/ORDER_SHIPPED/words', { body: { subject: 'a\nb' } })).code).toBe('VALIDATION_FAILED');
    expect((await operator.request('PUT', '/api/admin/email/kinds/NOPE/words', { body: { subject: 'x' } })).statusCode).toBe(404);
    const preview = safeJson(await auditor.get('/api/admin/email/kinds/ORDER_SHIPPED/preview')) as { subject: string; html: string };
    expect(preview.subject).toBe('On its way: OR-7F3A21C9');
    expect(preview.html).toContain('<!DOCTYPE html>');
    const draft = safeJson(await operator.post('/api/admin/email/kinds/ORDER_SHIPPED/preview', { subject: 'Draft {orderRef}' })) as { subject: string };
    expect(draft.subject).toBe('Draft OR-7F3A21C9');
    expect((await operator.request('PUT', '/api/admin/email/kinds/ORDER_SHIPPED/words', { body: { subject: null } })).statusCode).toBe(200);
    const audits = await h.ctx.db.selectFrom('audit_logs').select(['action', 'details']).where('action', 'like', 'email.%').orderBy('id').execute();
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['email.kind.enable', 'email.template.update']));

    // A test to oneself (ADMIN), to the console member's own address, whether the kind is on or not.
    const test = await admin.post('/api/admin/email/kinds/ORDER_SHIPPED/test', {});
    expect(test.statusCode).toBe(201);
    const testId = (safeJson(test) as { id: string }).id;
    const row = await h.ctx.db.selectFrom('email_outbox').selectAll().where('id', '=', testId).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ kind: 'ORDER_SHIPPED', account_id: null, preregistration_id: null, status: 'QUEUED' });
    expect(row.to_address).toMatch(/@/);
    expect((await operator.post('/api/admin/email/kinds/ORDER_SHIPPED/test', {})).statusCode).toBe(403);

    // The outbox: addresses in clear for an OPERATOR, masked for an AUDITOR; a reset link's code never shown.
    const listed = safeJson(await auditor.get('/api/admin/email/outbox?kind=PASSWORD_RESET&pageSize=5')) as { items: { id: string; to: string }[]; total: number };
    expect(listed.total).toBeGreaterThan(0);
    expect(listed.items.every((e) => /^.\*\*\*@/.test(e.to))).toBe(true);
    const clear = safeJson(await operator.get('/api/admin/email/outbox?kind=PASSWORD_RESET&pageSize=5')) as { items: { to: string }[] };
    expect(clear.items.every((e) => !e.to.includes('***'))).toBe(true);
    const one = safeJson(await operator.get(`/api/admin/email/outbox/${listed.items[0]!.id}`)) as { text: string; html: string };
    expect(one.text).toContain('/verify/reset#…');
    expect(one.text).not.toMatch(/\/verify\/reset#[^…]/);
    expect(one.html).not.toMatch(/\/verify\/reset#[^…]/);
    // An email one may stop: its unsubscribe link's token never shown either (M1.17 verification).
    expect((await admin.request('PUT', '/api/admin/email/kinds/RELEASE_NOTICE/enabled', { body: { enabled: true } })).statusCode).toBe(200);
    const { email: holder } = await accountClient(h);
    const holderId = (await h.ctx.db.selectFrom('accounts').select('id').where('email', '=', holder).executeTakeFirstOrThrow()).id;
    const notice = await h.ctx.services.email.enqueue(h.ctx.db, {
      kind: 'RELEASE_NOTICE',
      to: holder,
      accountId: holderId,
      dedupeKey: `E2:00000000-0000-4000-8000-000000000001:${holderId}`,
      values: { firstName: 'Owner', release: 'A release', opensAt: new Date(), access: 'It is open to every ORBES account.', link: `${ORIGIN}/verify/releases/x` },
    });
    expect(notice.queued).toBe(true);
    const noticeRow = await h.ctx.db.selectFrom('email_outbox').select(['body_text']).where('id', '=', notice.queued ? notice.id : '').executeTakeFirstOrThrow();
    expect(noticeRow.body_text).toMatch(/\/verify\/unsubscribe#r\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{8}/);
    const shown = safeJson(await auditor.get(`/api/admin/email/outbox/${notice.queued ? notice.id : ''}`)) as { text: string; html: string };
    expect(shown.text).toContain('/verify/unsubscribe#…');
    for (const words of [shown.text, shown.html]) expect(words).not.toMatch(/\/verify\/unsubscribe#[^…]|\/api\/v1\/email\/unsubscribe\?t=[^…]/);
    expect((await auditor.get('/api/admin/email/outbox/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    const counts = (safeJson(await auditor.get('/api/admin/email')) as { outbox: { queued: number } }).outbox;
    expect(counts.queued).toBeGreaterThan(0);
  });

  it('the founding announcement’s panel and its send (ADMIN, the phrase)', async () => {
    const admin = await adminClient(h, 'ADMIN');
    const auditor = await adminClient(h, 'AUDITOR');
    const panel = safeJson(await auditor.get('/api/admin/email/announcement')) as { channel: boolean; enabled: boolean; reach: number; releases: unknown[] };
    expect(panel).toMatchObject({ channel: true, enabled: false, releases: [] });
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect((await auditor.post(`/api/admin/email/announcement/${unknown}`, { when: 'NOW', phrase: 'SEND 00000000' })).statusCode).toBe(403);
    const res = await admin.post(`/api/admin/email/announcement/${unknown}`, { when: 'NOW', phrase: 'SEND 00000000' });
    expect(res.statusCode).toBe(404);
    expect((await admin.post(`/api/admin/email/announcement/${unknown}`, { when: 'LATER', phrase: 'SEND 00000000' })).statusCode).toBe(400);
    expect(safeJson(await admin.post(`/api/admin/email/announcement/${unknown}/cancel`, {}))).toMatchObject({ error: { code: 'DROP_NOT_FOUND' } });
    // The panel's preview of a release (AUDITOR): an unknown one 404 (the release's words: email-triggers.test.ts).
    const preview = await auditor.get(`/api/admin/email/announcement/${unknown}/preview`);
    expect(preview.statusCode).toBe(404);
    expect(preview.headers['cache-control']).toBe('no-store');
    expect((await auditor.get('/api/admin/email/announcement/nope/preview')).statusCode).toBe(400);
  });
});
