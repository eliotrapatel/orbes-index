/**
 * The emails' channel (lot M1 plan §4.1, §4.5; services/email.ts, email/render.ts, email/copy.ts), on PGlite with the
 * fake SMTP server (test/support/fake-smtp.ts) — never a real provider:
 *  - off (the default) nothing is queued; a kind not switched on queues nothing; a key queues once; the act's
 *    transaction carries the email (rolled back, no email);
 *  - the sender: SENT with its headers (Message-ID the row's id, List-Unsubscribe on an email one may stop), not before
 *    its time, the retries 1 min, 5 min, 30 min, 2 h then FAILED, FAILED at once on a permanent refusal, no credential in
 *    `last_error`, no address in the log, two senders never sending one email twice, the loop every 15 s, a stop or
 *    half the lease between two emails giving the rest back;
 *  - the 90-day purge; the unsubscribe token; the rendering of every kind, default and edited words, escaped values.
 *
 * CI (PostgreSQL): « two senders claim the outbox without sending twice (FOR UPDATE SKIP LOCKED), on PostgreSQL ».
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { testConfig, type AppConfig, type EmailConfig } from '../../src/server/config.js';
import { createContext, startHousekeeping, type AppContext } from '../../src/server/context.js';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { EMAIL_KINDS, type EmailKind } from '../../src/server/db/schema.js';
import { EMAIL_DEFAULTS, EMAIL_PLACEHOLDERS, EMAIL_SAMPLE_VALUES, OPT_IN_KINDS } from '../../src/server/email/copy.js';
import { emailMonogramPng, emailWhen, renderEmail } from '../../src/server/email/render.js';
import { CANCELLED_WORDS, deriveEmailUnsubscribeKey, EMAIL_RETENTION_DAYS, EMAIL_SENDER, EmailService, type EmailTransport } from '../../src/server/services/email.js';
import { createManualClock, type Logger, type ManualClock } from '../../src/server/types.js';
import { createTestDb } from '../support/db.js';
import { startFakeSmtp, type FakeSmtp, type FakeSmtpOptions } from '../support/fake-smtp.js';
import { createAdmin, createHarness, PASSWORD } from '../api/support.js';

const ORIGIN = 'https://verify.orbes.test';
const KEY = deriveEmailUnsubscribeKey(testConfig());

/** A logger that keeps every line. */
function capture(): Logger & { lines: { level: string; o: unknown; m?: string }[] } {
  const lines: { level: string; o: unknown; m?: string }[] = [];
  const at = (level: string) => (o: object | string, m?: string) => lines.push({ level, o, m });
  return { lines, info: at('info'), warn: at('warn'), error: at('error') };
}

const smtpConfig = (s: Pick<FakeSmtp, 'port' | 'user' | 'password'>, security: 'tls' | 'starttls' = 'tls'): EmailConfig => ({
  transport: 'smtp',
  from: { address: 'hello@theorbes.com', name: 'ORBES' },
  replyTo: 'clientservices@theorbes.com',
  smtp: { host: 'localhost', port: s.port, security, user: s.user, password: s.password },
});

describe('the emails: outbox, sender, purge, unsubscribe', () => {
  let ctx: AppContext;
  let db: Db;
  let closeAll: () => Promise<void>;
  let clock: ManualClock;
  let adminId: string;
  const servers: FakeSmtp[] = [];

  beforeAll(async () => {
    const t = await createTestDb();
    clock = createManualClock('2026-11-02T09:00:00.000Z');
    ctx = await createContext(testConfig({ publicOrigin: ORIGIN }), { db: t.db, clock: clock.now });
    db = ctx.db;
    adminId = (await createAdmin(ctx, 'ADMIN')).id;
    closeAll = async () => {
      await ctx.close();
      await t.close();
    };
  });
  afterAll(() => closeAll());
  afterEach(async () => {
    await db.deleteFrom('email_outbox').execute();
    await db.deleteFrom('email_templates').execute();
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  async function fake(options: Partial<FakeSmtpOptions> = {}): Promise<FakeSmtp> {
    const s = await startFakeSmtp({ security: 'tls', ...options });
    servers.push(s);
    return s;
  }

  /** An EmailService on the fake server (or a transport of the test's own). */
  function service(s: FakeSmtp | null, opts: { log?: Logger; transport?: EmailTransport; email?: EmailConfig } = {}): EmailService {
    return new EmailService({
      db,
      config: { publicOrigin: ORIGIN, email: opts.email ?? (s ? smtpConfig(s) : smtpConfig({ port: 1, user: 'u', password: 'p' })) },
      unsubscribeKey: KEY,
      clock: clock.now,
      ...(opts.log ? { log: opts.log } : {}),
      ...(opts.transport ? { transport: opts.transport } : {}),
      smtp: { ...(s ? { ca: s.ca } : {}), timeouts: { connectMs: 3_000, commandMs: 3_000, dataMs: 3_000 } },
    });
  }

  async function switchOn(kind: EmailKind, words: { subject?: string; body?: string } = {}): Promise<void> {
    await db
      .insertInto('email_templates')
      .values({ kind, enabled: true, subject: words.subject ?? null, body: words.body ?? null, updated_by: adminId })
      .onConflict((oc) => oc.column('kind').doUpdateSet({ enabled: true, subject: words.subject ?? null, body: words.body ?? null }))
      .execute();
  }

  let n = 0;
  async function account(): Promise<{ id: string; email: string }> {
    n += 1;
    const email = `collector-${n}-${randomBytes(3).toString('hex')}@example.com`;
    const { account } = await ctx.services.auth.registerAccount({ email, password: PASSWORD, firstName: 'Camille', lastName: 'Martin', country: 'FR' });
    return { id: account.id, email };
  }

  const outbox = () => db.selectFrom('email_outbox').selectAll().orderBy('created_at').execute();
  /** The account asked for the release notices in YOUR PROFILE (else the sender cancels one, lot M1 step M1.17). */
  const optIn = (accountId: string) => db.insertInto('email_preferences').values({ account_id: accountId, release_notices: true }).onConflict((oc) => oc.column('account_id').doNothing()).execute();

  it('queues nothing while the channel is off (the default), whatever the kind', async () => {
    expect(ctx.config.email).toEqual({ transport: 'off' });
    expect(ctx.services.email.on).toBe(false);
    expect(ctx.services.email.channel()).toEqual({ on: false });
    await switchOn('ORDER_CONFIRMED');
    const a = await account();
    expect(await ctx.services.email.enqueue(db, { kind: 'ORDER_CONFIRMED', to: a.email, accountId: a.id, dedupeKey: 'ORDER_CONFIRMED:x' })).toEqual({ queued: false, reason: 'OFF' });
    expect(await outbox()).toEqual([]);
    expect(await ctx.services.email.sendDue()).toEqual({ sent: 0, retried: 0, failed: 0, cancelled: 0 });
  });

  it('queues a kind only once it is switched on, once per key, in the transaction of the act that causes it', async () => {
    const email = service(null);
    const a = await account();
    const input = { kind: 'ORDER_SHIPPED' as const, to: ` ${a.email} `, accountId: a.id, dedupeKey: 'ORDER_SHIPPED:o1', values: { firstName: 'Camille', orderRef: 'OR-7F3A21C9', carrier: 'Colissimo', trackingUrl: 'https://tracking.example/abc', link: `${ORIGIN}/verify/pieces` } };
    expect(await email.enqueue(db, input)).toEqual({ queued: false, reason: 'KIND_OFF' });
    // A row switched off is off too.
    await db.insertInto('email_templates').values({ kind: 'ORDER_SHIPPED', enabled: false, updated_by: adminId }).execute();
    expect(await email.enqueue(db, input)).toEqual({ queued: false, reason: 'KIND_OFF' });
    await switchOn('ORDER_SHIPPED');
    const first = await email.enqueue(db, input);
    expect(first).toEqual({ queued: true, id: expect.any(String) });
    expect(await email.enqueue(db, input)).toEqual({ queued: false, reason: 'DUPLICATE' });
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'ORDER_SHIPPED',
      dedupe_key: 'ORDER_SHIPPED:o1',
      account_id: a.id,
      preregistration_id: null,
      to_address: a.email,
      subject: 'Your order OR-7F3A21C9 is on its way',
      status: 'QUEUED',
      attempts: 0,
      last_error: null,
      sent_at: null,
      settled_at: null,
    });
    expect(rows[0]!.not_before.toISOString()).toBe(clock.now().toISOString());
    expect(rows[0]!.body_text).toContain('Your order OR-7F3A21C9 has left ORBES with Colissimo.');
    expect(rows[0]!.body_text).toContain('FOLLOW THE PARCEL: https://tracking.example/abc');
    expect(rows[0]!.body_html).toContain('href="https://tracking.example/abc"');

    // Rolled back with its act: no email.
    await expect(
      db.transaction().execute(async (tx) => {
        expect(await email.enqueue(tx, { ...input, dedupeKey: 'ORDER_SHIPPED:o2' })).toMatchObject({ queued: true });
        throw new Error('the act failed');
      }),
    ).rejects.toThrow('the act failed');
    expect(await outbox()).toHaveLength(1);

    // An address the envelope cannot carry is left out; a key that is not one line is refused.
    expect(await email.enqueue(db, { ...input, to: 'cämille@example.com', dedupeKey: 'ORDER_SHIPPED:o3' })).toEqual({ queued: false, reason: 'ADDRESS' });
    await expect(email.enqueue(db, { ...input, dedupeKey: 'a\nb' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(email.enqueue(db, { ...input, dedupeKey: 'x'.repeat(201) })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // An email one may stop needs its person: the pre-registration (E1) or the account (E2).
    await expect(email.enqueue(db, { kind: 'RELEASE_NOTICE', to: a.email, dedupeKey: 'E2:x' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('sends what is due over SMTP: SENT with the row’s Message-ID and, on an email one may stop, its one-click unsubscribe; never before its time', async () => {
    const s = await fake();
    const log = capture();
    const email = service(s, { log });
    const a = await account();
    await switchOn('RELEASE_NOTICE');
    await switchOn('ORDER_CONFIRMED');
    await optIn(a.id);
    const notice = await email.enqueue(db, { kind: 'RELEASE_NOTICE', to: a.email, accountId: a.id, dedupeKey: 'E2:r1:a', values: { firstName: 'Camille', release: 'The November release', opensAt: new Date('2026-11-05T18:00:00Z'), access: 'It is open to every ORBES account.', link: `${ORIGIN}/verify/releases` } });
    const later = await email.enqueue(db, { kind: 'ORDER_CONFIRMED', to: a.email, accountId: a.id, dedupeKey: 'E4:o9', notBefore: new Date(clock.now().getTime() + 60_000), values: { orderRef: 'OR-1' } });
    if (!notice.queued || !later.queued) throw new Error('not queued');

    expect(await email.sendDue()).toEqual({ sent: 1, retried: 0, failed: 0, cancelled: 0 });
    expect(s.messages).toHaveLength(1);
    const m = s.messages[0]!;
    expect(m.to).toEqual([a.email]);
    expect(m.from).toBe('hello@theorbes.com');
    expect(m.data).toContain(`\r\nMessage-ID: <${notice.id}@theorbes.com>\r\n`);
    const token = email.unsubscribeToken('RELEASE_NOTICE', a.id);
    expect(m.data).toContain(`\r\nList-Unsubscribe: <${ORIGIN}/api/v1/email/unsubscribe?t=${token}>\r\n`);
    expect(m.data).toContain('\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n');
    expect(m.data).toContain('Subject: A release is announced');
    const sent = await db.selectFrom('email_outbox').selectAll().where('id', '=', notice.id).executeTakeFirstOrThrow();
    expect(sent).toMatchObject({ status: 'SENT', attempts: 1, last_error: null });
    expect(sent.sent_at?.toISOString()).toBe(clock.now().toISOString());
    expect(sent.settled_at?.toISOString()).toBe(clock.now().toISOString());
    // The body says when, in Paris time, and names the page that stops these emails.
    expect(sent.body_text).toContain('The November release opens Thursday 5 November at 19:00, Paris time.');
    expect(sent.body_text).toContain(`STOP THESE EMAILS: ${ORIGIN}/verify/unsubscribe#${token}`);

    // The order's email waits for its time.
    expect(await email.sendDue()).toEqual({ sent: 0, retried: 0, failed: 0, cancelled: 0 });
    clock.advance(60_000);
    expect(await email.sendDue()).toEqual({ sent: 1, retried: 0, failed: 0, cancelled: 0 });
    expect(s.messages[1]!.data).not.toMatch(/List-Unsubscribe/);
    expect(await email.sendDue()).toEqual({ sent: 0, retried: 0, failed: 0, cancelled: 0 });
    expect(s.messages).toHaveLength(2);

    // The log names the kind and the row, never the address.
    expect(log.lines.filter((l) => l.m === 'email sent').map((l) => l.o)).toEqual([
      { kind: 'RELEASE_NOTICE', id: notice.id },
      { kind: 'ORDER_CONFIRMED', id: later.id },
    ]);
    expect(JSON.stringify(log.lines)).not.toContain('@example.com');
  });

  it('tries again 1 min, 5 min, 30 min and 2 h after each failure, then gives up: FAILED with the server’s words, never the credentials', async () => {
    const s = await fake({ replies: { message: '451 4.3.0 Mailbox busy, try again later' } });
    const log = capture();
    const email = service(s, { log });
    const a = await account();
    await switchOn('PASSWORD_RESET');
    const q = await email.enqueue(db, { kind: 'PASSWORD_RESET', to: a.email, accountId: a.id, dedupeKey: 'E3:1', values: { resetLink: `${ORIGIN}/verify/reset#x` } });
    if (!q.queued) throw new Error('not queued');
    const row = () => db.selectFrom('email_outbox').selectAll().where('id', '=', q.id).executeTakeFirstOrThrow();

    const delays = [...EMAIL_SENDER.retryMs];
    expect(delays).toEqual([60_000, 300_000, 1_800_000, 7_200_000]);
    for (const [i, delay] of delays.entries()) {
      expect(await email.sendDue()).toEqual({ sent: 0, retried: 1, failed: 0, cancelled: 0 });
      const r = await row();
      expect(r).toMatchObject({ status: 'QUEUED', attempts: i + 1, settled_at: null });
      expect(r.last_error).toMatch(/^message: 451 4\.3\.0 Mailbox busy/);
      expect(r.not_before.getTime() - clock.now().getTime()).toBe(delay);
      clock.advance(delay - 1);
      expect(await email.sendDue()).toEqual({ sent: 0, retried: 0, failed: 0, cancelled: 0 });
      clock.advance(1);
    }
    expect(await email.sendDue()).toEqual({ sent: 0, retried: 0, failed: 1, cancelled: 0 });
    const failed = await row();
    expect(failed).toMatchObject({ status: 'FAILED', attempts: 5, sent_at: null });
    expect(failed.settled_at?.toISOString()).toBe(clock.now().toISOString());
    expect(s.connections).toBe(5);
    clock.advance(24 * 3_600_000);
    expect(await email.sendDue()).toEqual({ sent: 0, retried: 0, failed: 0, cancelled: 0 });
    expect(log.lines.filter((l) => l.m === 'email failed').map((l) => (l.o as { final: boolean }).final)).toEqual([false, false, false, false, true]);
    expect(JSON.stringify(log.lines)).not.toContain(a.email);

    // The credentials refused: tried again, and the words kept hold neither the user nor the password.
    const wrong = await fake();
    const leaky = service(wrong, { email: smtpConfig({ port: wrong.port, user: wrong.user, password: 'a-wrong-password-42' }) });
    const q2 = await leaky.enqueue(db, { kind: 'PASSWORD_RESET', to: a.email, accountId: a.id, dedupeKey: 'E3:2', values: {} });
    if (!q2.queued) throw new Error('not queued');
    expect(await leaky.sendDue()).toEqual({ sent: 0, retried: 1, failed: 0, cancelled: 0 });
    const r2 = await db.selectFrom('email_outbox').selectAll().where('id', '=', q2.id).executeTakeFirstOrThrow();
    expect(r2.last_error).toMatch(/^auth: 535/);
    expect(r2.last_error).not.toContain(wrong.user);
    expect(r2.last_error).not.toContain('a-wrong-password-42');

    // A message that cannot even be written (an unsubscribe link on http, a dev origin) is refused alike on every try:
    // FAILED at once, never tried again.
    await switchOn('RELEASE_NOTICE');
    await optIn(a.id);
    const dev = new EmailService({ db, config: { publicOrigin: 'http://localhost:8080', email: smtpConfig(s) }, unsubscribeKey: KEY, clock: clock.now, transport: async () => {} });
    const q3 = await dev.enqueue(db, { kind: 'RELEASE_NOTICE', to: a.email, accountId: a.id, dedupeKey: 'E2:dev1', values: {} });
    if (!q3.queued) throw new Error('not queued');
    expect(await dev.sendDue()).toEqual({ sent: 0, retried: 0, failed: 1, cancelled: 0 });
    expect(await db.selectFrom('email_outbox').selectAll().where('id', '=', q3.id).executeTakeFirstOrThrow()).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      last_error: 'unsubscribe: an https address',
    });
  });

  it('gives up at once when the server refuses the address for good (a 5xx to RCPT TO)', async () => {
    const s = await fake({ replies: { rcpt: '550 5.1.1 Recipient address rejected: user unknown' } });
    const email = service(s);
    const a = await account();
    await switchOn('ORDER_DELIVERED');
    await email.enqueue(db, { kind: 'ORDER_DELIVERED', to: a.email, accountId: a.id, dedupeKey: 'E4:d1', values: {} });
    expect(await email.sendDue()).toEqual({ sent: 0, retried: 0, failed: 1, cancelled: 0 });
    expect((await outbox())[0]).toMatchObject({ status: 'FAILED', attempts: 1, last_error: expect.stringMatching(/^rcpt: 550 5\.1\.1/) });
  });

  it('cancels at send time, without sending, an email whose account is no longer ACTIVE or whose pre-registration unsubscribed (lot M1 step M1.17)', async () => {
    const sent: string[] = [];
    const email = service(null, { transport: async (e) => void sent.push(e.to) });
    await switchOn('ORDER_CONFIRMED');
    await switchOn('FOUNDING_ANNOUNCEMENT');
    const kept = await account();
    const locked = await account();
    for (const [a, key] of [[kept, 'E4:k'], [locked, 'E4:l']] as const) {
      await email.enqueue(db, { kind: 'ORDER_CONFIRMED', to: a.email, accountId: a.id, dedupeKey: key, values: {} });
      clock.advance(10);
    }
    await db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', locked.id).execute();
    const p = (await ctx.services.founding.register({ email: `unsub-${randomBytes(3).toString('hex')}@example.com`, firstName: 'Léa', country: 'FR', consent: true }, { type: 'system', id: 'public' })) as { id: string };
    const row = await db.selectFrom('preregistrations').select('email').where('id', '=', p.id).executeTakeFirstOrThrow();
    await email.enqueue(db, { kind: 'FOUNDING_ANNOUNCEMENT', to: row.email, preregistrationId: p.id, dedupeKey: `E1:x:${p.id}`, values: {} });
    await db.updateTable('preregistrations').set({ unsubscribed_at: clock.now() }).where('id', '=', p.id).execute();
    const log = capture();
    const logged = service(null, { log, transport: async (e) => void sent.push(e.to) });
    expect(await logged.sendDue()).toEqual({ sent: 1, retried: 0, failed: 0, cancelled: 2 });
    expect(sent).toEqual([kept.email]);
    const rows = await outbox();
    expect(rows.map((r) => [r.dedupe_key, r.status, r.last_error, r.sent_at === null, r.settled_at?.toISOString()])).toEqual([
      ['E4:k', 'SENT', null, false, clock.now().toISOString()],
      ['E4:l', 'CANCELLED', CANCELLED_WORDS.notActive, true, clock.now().toISOString()],
      [`E1:x:${p.id}`, 'CANCELLED', CANCELLED_WORDS.unsubscribed, true, clock.now().toISOString()],
    ]);
    expect(log.lines.filter((l) => l.m === 'email cancelled')).toHaveLength(2);
    expect(JSON.stringify(log.lines)).not.toContain('@example.com');
  });

  it('two senders at once never send one email twice, and a pass takes 50 at most, the oldest first', async () => {
    const sent: string[] = [];
    const transport: EmailTransport = async (e) => {
      await new Promise((r) => setTimeout(r, 1));
      sent.push(/Message-ID: <([^@]+)@/.exec(e.data)![1]!);
    };
    const one = service(null, { transport });
    const two = service(null, { transport });
    await switchOn('ORDER_CANCELLED');
    const a = await account();
    for (let i = 0; i < 60; i++) {
      await one.enqueue(db, { kind: 'ORDER_CANCELLED', to: a.email, accountId: a.id, dedupeKey: `E5:c${String(i).padStart(2, '0')}`, values: {} });
      clock.advance(10);
    }
    const [r1, r2] = await Promise.all([one.sendDue(), two.sendDue()]);
    expect(r1.sent + r2.sent).toBe(60);
    expect(Math.max(r1.sent, r2.sent)).toBeLessThanOrEqual(EMAIL_SENDER.batch);
    expect(new Set(sent).size).toBe(60);
    expect(sent).toHaveLength(60);
    expect(await one.sendDue()).toEqual({ sent: 0, retried: 0, failed: 0, cancelled: 0 });
    expect((await outbox()).every((r) => r.status === 'SENT' && r.attempts === 1)).toBe(true);
  });

  it('stops between two emails: stop() returns after the email in progress, the rest given back due at once, none sent twice; a pass ends at half the lease', async () => {
    expect(EMAIL_SENDER.passMs).toBe(EMAIL_SENDER.leaseMs / 2);
    const idOf = (data: string) => /Message-ID: <([^@]+)@/.exec(data)![1]!;
    const sent: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let begin!: () => void;
    const begun = new Promise<void>((r) => (begin = r));
    const closing = service(null, {
      transport: async (e) => {
        begin();
        await gate;
        sent.push(idOf(e.data));
      },
    });
    await switchOn('ORDER_CANCELLED');
    const a = await account();
    for (let i = 0; i < 5; i++) {
      await closing.enqueue(db, { kind: 'ORDER_CANCELLED', to: a.email, accountId: a.id, dedupeKey: `E5:s${i}`, values: {} });
      clock.advance(10);
    }
    closing.start();
    await begun;
    let stopped = false;
    const stop = closing.stop().then(() => void (stopped = true));
    await new Promise((r) => setTimeout(r, 30));
    expect(stopped).toBe(false); // the email in progress first
    release();
    await stop;
    expect(sent).toHaveLength(1);
    const rows = await outbox();
    expect(rows.filter((r) => r.status === 'SENT').map((r) => [r.id, r.attempts])).toEqual([[sent[0], 1]]);
    const rest = rows.filter((r) => r.status === 'QUEUED');
    expect(rest).toHaveLength(4);
    expect(rest.every((r) => r.attempts === 0 && r.not_before.getTime() === clock.now().getTime())).toBe(true);
    // The next process sends them at once, each once.
    const next = service(null, { transport: async (e) => void sent.push(idOf(e.data)) });
    expect(await next.sendDue()).toEqual({ sent: 4, retried: 0, failed: 0, cancelled: 0 });
    expect(new Set(sent).size).toBe(5);
    expect(sent).toHaveLength(5);

    // A slow provider (2 min an email): the pass tries no further email 5 min after its claim and gives the rest back.
    const slow = service(null, {
      transport: async (e) => {
        clock.advance(2 * 60_000);
        sent.push(idOf(e.data));
      },
    });
    for (let i = 0; i < 6; i++) await slow.enqueue(db, { kind: 'ORDER_CANCELLED', to: a.email, accountId: a.id, dedupeKey: `E5:t${i}`, values: {} });
    expect(await slow.sendDue()).toEqual({ sent: 3, retried: 0, failed: 0, cancelled: 0 });
    const back = (await outbox()).filter((r) => r.status === 'QUEUED');
    expect(back).toHaveLength(3);
    expect(back.every((r) => r.attempts === 0 && r.not_before.getTime() === clock.now().getTime())).toBe(true);
    expect(await slow.sendDue()).toEqual({ sent: 3, retried: 0, failed: 0, cancelled: 0 });
    expect(new Set(sent).size).toBe(11);
    expect(sent).toHaveLength(11);
    expect((await outbox()).every((r) => r.status === 'SENT' && r.attempts === 1)).toBe(true);
  });

  it('runs its loop every 15 s while the channel is on, and never while it is off', async () => {
    expect(EMAIL_SENDER.intervalMs).toBe(15_000);
    const sent: string[] = [];
    const looping = service(null, { transport: async (e) => void sent.push(e.to) });
    const off = new EmailService({ db, config: { publicOrigin: ORIGIN, email: { transport: 'off' } }, unsubscribeKey: KEY, clock: clock.now, transport: async (e) => void sent.push(`off:${e.to}`) });
    await switchOn('CARE_LABEL');
    const a = await account();
    await looping.enqueue(db, { kind: 'CARE_LABEL', to: a.email, accountId: a.id, dedupeKey: 'E5:care1', values: {} });
    off.start();
    looping.start();
    for (let i = 0; i < 200 && sent.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    await looping.stop();
    await off.stop();
    expect(sent).toEqual([a.email]);
  });

  it('purges an email 90 days after it was sent, failed or was cancelled, never one still queued (housekeeping’s emailPurge)', async () => {
    const email = service(null, { transport: async () => {} });
    await switchOn('WARRANTY_LABEL');
    const a = await account();
    const ids: Record<string, string> = {};
    for (const key of ['sent-old', 'failed-old', 'cancelled-old', 'sent-recent', 'queued-old']) {
      const r = await email.enqueue(db, { kind: 'WARRANTY_LABEL', to: a.email, accountId: a.id, dedupeKey: key, values: {} });
      if (!r.queued) throw new Error('not queued');
      ids[key] = r.id;
    }
    const now = clock.now();
    const at = (days: number) => new Date(now.getTime() - days * 86_400_000);
    await db.updateTable('email_outbox').set({ status: 'SENT', sent_at: at(91), settled_at: at(91) }).where('id', '=', ids['sent-old']!).execute();
    await db.updateTable('email_outbox').set({ status: 'FAILED', settled_at: at(EMAIL_RETENTION_DAYS + 0.01), last_error: 'rcpt: 550' }).where('id', '=', ids['failed-old']!).execute();
    await db.updateTable('email_outbox').set({ status: 'CANCELLED', settled_at: at(120) }).where('id', '=', ids['cancelled-old']!).execute();
    await db.updateTable('email_outbox').set({ status: 'SENT', sent_at: at(89), settled_at: at(89) }).where('id', '=', ids['sent-recent']!).execute();
    // Queued for 400 days (its content and creation never change; its time does): still not settled, never purged.
    await db.updateTable('email_outbox').set({ not_before: at(400), attempts: 3, last_error: 'message: 451 busy' }).where('id', '=', ids['queued-old']!).execute();
    expect(EMAIL_RETENTION_DAYS).toBe(90);
    const hk = startHousekeeping(ctx, { intervalMs: 3_600_000 });
    try {
      expect((await hk.runOnce()).emailPurge).toBe(3);
    } finally {
      await hk.stop();
    }
    expect((await outbox()).map((r) => r.dedupe_key).sort()).toEqual(['queued-old', 'sent-recent']);
    expect(await email.purge(clock.now())).toBe(0);
  });

  it('signs the unsubscribe links: the kind and the person’s id under the server’s key, refused when changed', () => {
    const email = service(null);
    const id = randomUUID();
    const token = email.unsubscribeToken('FOUNDING_ANNOUNCEMENT', id);
    expect(token).toMatch(/^f\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{22}$/);
    expect(email.readUnsubscribeToken(token)).toEqual({ kind: 'FOUNDING_ANNOUNCEMENT', subjectId: id });
    expect(email.unsubscribeToken('FOUNDING_ANNOUNCEMENT', id.toUpperCase())).toBe(token);
    const notice = email.unsubscribeToken('RELEASE_NOTICE', id);
    expect(notice.startsWith('r.')).toBe(true);
    expect(email.readUnsubscribeToken(notice)).toEqual({ kind: 'RELEASE_NOTICE', subjectId: id });
    // Another kind's letter, another id, a changed signature, another server's key: nothing.
    expect(email.readUnsubscribeToken(`r${token.slice(1)}`)).toBeNull();
    expect(email.readUnsubscribeToken(token.replace(id, randomUUID()))).toBeNull();
    const sig = token.slice(-22);
    expect(email.readUnsubscribeToken(`${token.slice(0, -22)}${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`)).toBeNull();
    const elsewhere = new EmailService({ db, config: { publicOrigin: ORIGIN, email: { transport: 'off' } }, unsubscribeKey: deriveEmailUnsubscribeKey(testConfig({ cookieSecret: 'another-cookie-secret-for-another-server-000001' })), clock: clock.now });
    expect(elsewhere.readUnsubscribeToken(token)).toBeNull();
    for (const bad of [undefined, null, 42, '', 'f..', `x.${id}.${sig}`, `${token}x`, `${token}\n`]) expect(email.readUnsubscribeToken(bad)).toBeNull();
    // Only the emails one may stop have a link.
    expect(() => email.unsubscribeToken('ORDER_CONFIRMED', id)).toThrow();
    expect(email.unsubscribeLinks('RELEASE_NOTICE', id)).toEqual({ page: `${ORIGIN}/verify/unsubscribe#${notice}`, oneClick: `${ORIGIN}/api/v1/email/unsubscribe?t=${notice}` });
  });
});

// ── The rendering ──────────────────────────────────────────────────────────

describe('the emails’ words and look (email/render.ts, email/copy.ts)', () => {
  const unsubscribe = `${ORIGIN}/verify/unsubscribe#f.x`;
  const render = (kind: EmailKind, values: Record<string, string | Date | null> = { ...EMAIL_SAMPLE_VALUES }, words = EMAIL_DEFAULTS[kind]) =>
    renderEmail({ kind, words, values, origin: ORIGIN, unsubscribeUrl: OPT_IN_KINDS.has(kind) ? unsubscribe : null });

  it('renders every kind with its default words: every placeholder filled, its button, the frame, and STOP THESE EMAILS only where one may stop', () => {
    expect(Object.keys(EMAIL_DEFAULTS).sort()).toEqual([...EMAIL_KINDS].sort());
    expect(Object.keys(EMAIL_PLACEHOLDERS).sort()).toEqual([...EMAIL_KINDS].sort());
    for (const kind of EMAIL_KINDS) {
      // Every placeholder the default words use is one the kind's trigger fills.
      const used = [...`${EMAIL_DEFAULTS[kind].subject}\n${EMAIL_DEFAULTS[kind].body}`.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const p of used) expect(EMAIL_PLACEHOLDERS[kind], `${kind} {${p}}`).toContain(p);
      const r = render(kind);
      expect(r.subject.length, kind).toBeGreaterThan(0);
      for (const part of [r.subject, r.text, r.html]) expect(part, kind).not.toMatch(/\{\w+\}/);
      expect(r.text.startsWith('ORBES\n\nCamille,\n\n'), kind).toBe(true);
      expect(r.text.trimEnd().endsWith('ORBES · PARIS'), kind).toBe(true);
      expect(r.html, kind).toContain(`<img src="${ORIGIN}/api/v1/email/monogram.png" width="44" height="44" alt=""`);
      expect(r.html, kind).toContain('<meta name="color-scheme" content="dark light">');
      expect(r.html, kind).toContain('@media (prefers-color-scheme: light)');
      expect(r.html, kind).toMatch(/class="o-button"/);
      expect(r.html.includes('STOP THESE EMAILS'), kind).toBe(OPT_IN_KINDS.has(kind));
      expect(r.text.includes(`STOP THESE EMAILS: ${unsubscribe}`), kind).toBe(OPT_IN_KINDS.has(kind));
      // No exclamation mark, no word of the house's "Never use" list that an email could carry.
      expect(`${r.subject} ${r.text}`, kind).not.toMatch(/!|\b(?:lottery|genuine|fake|counterfeit|atelier|handmade|oops|error)\b/i);
      // No script, no form, no remote style.
      expect(r.html, kind).not.toMatch(/<script|<form|<link|<iframe|javascript:/i);
    }
    expect(OPT_IN_KINDS).toEqual(new Set(['FOUNDING_ANNOUNCEMENT', 'RELEASE_NOTICE']));
  });

  it('escapes every value (a first name comes from a public form), and drops a button whose link is not an http(s) address', () => {
    const r = render('DRAW_SELECTED', { firstName: '<img src=x onerror=alert(1)>"&', release: 'The <b>November</b> release', heldUntil: new Date('2026-11-07T18:00:00Z'), link: 'javascript:alert(1)' });
    expect(r.html).not.toContain('<img src=x');
    expect(r.html).not.toContain('<b>November</b>');
    expect(r.html).toContain('&lt;img src=x onerror=alert(1)&gt;&quot;&amp;,');
    expect(r.html).not.toContain('javascript:');
    expect(r.html).not.toContain('SEE THE RELEASE');
    expect(r.text).not.toContain('SEE THE RELEASE');
    expect(r.text).toContain('It is held until Saturday 7 November at 19:00, Paris time. ORBES Client Services will contact you.');
    // A value never breaks the subject's line.
    const s = render('ORDER_CONFIRMED', { orderRef: 'OR-1\r\nBcc: x@example.com' });
    expect(s.subject).toBe('Your order OR-1 Bcc: x@example.com is confirmed');
  });

  it('uses the console’s words when it has some: placeholders, paragraphs, line breaks and its own button', () => {
    const r = render(
      'ORDER_CONFIRMED',
      { firstName: '', orderRef: 'OR-9', link: `${ORIGIN}/verify/pieces` },
      { subject: '  Order {orderRef}: thank you  ', body: '{firstName},\n\nFirst line\nsecond line.\n\n[VIEW MY ORDER]({link})\n\n[NOWHERE]({unknown})\n\nKeep {unknown} as written.' },
    );
    expect(r.subject).toBe('Order OR-9: thank you');
    expect(r.text).toBe(`ORBES\n\nHello,\n\nFirst line\nsecond line.\n\nVIEW MY ORDER: ${ORIGIN}/verify/pieces\n\nKeep {unknown} as written.\n\n—\n\nYou receive this email about your ORBES account.\n\nORBES · PARIS\n`);
    expect(r.html).toContain('First line<br>second line.');
    expect(r.html).toContain(`href="${ORIGIN}/verify/pieces"`);
    // An empty subject falls back on the kind's.
    expect(render('ORDER_CONFIRMED', { orderRef: 'OR-9' }, { subject: '   ', body: 'x' }).subject).toBe('Your order OR-9 is confirmed');
  });

  it('writes an instant in Paris time, summer or winter', () => {
    expect(emailWhen(new Date('2026-11-05T18:00:00Z'))).toBe('Thursday 5 November at 19:00');
    expect(emailWhen(new Date('2026-07-14T08:05:00Z'))).toBe('Tuesday 14 July at 10:05');
  });

  it('draws the monogram once, as a PNG, and serves it to any mail client', async () => {
    const png = await emailMonogramPng();
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await emailMonogramPng()).toBe(png);
    const h = await createHarness();
    try {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/email/monogram.png' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['cache-control']).toBe('public, max-age=86400');
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(Buffer.compare(res.rawPayload, Buffer.from(png))).toBe(0);
    } finally {
      await h.close();
    }
  });
});

// ── Two senders on PostgreSQL ──────────────────────────────────────────────

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;

describe.skipIf(!adminUrl)('two senders claim the outbox without sending twice (FOR UPDATE SKIP LOCKED), on PostgreSQL', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const admin = createDb(adminUrl!);
    const name = `orbes_email_${randomBytes(6).toString('hex')}`;
    await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin);
    const u = new URL(adminUrl!);
    u.pathname = `/${name}`;
    db = createDb(u.toString(), { poolMax: 8 });
    await migrateToLatest(db);
    close = async () => {
      await closeDb(db);
      await sql`DROP DATABASE IF EXISTS ${sql.id(name)} WITH (FORCE)`.execute(admin);
      await closeDb(admin);
    };
  });
  afterAll(() => close?.());

  it('four senders, 120 emails: each sent once, each claimed by one sender', async () => {
    const clock = createManualClock('2026-11-02T09:00:00.000Z');
    const ctx = await createContext(testConfig({ databaseUrl: 'pglite:memory' }), { db, clock: clock.now, migrate: false });
    try {
      const adminId = (await createAdmin(ctx, 'ADMIN')).id;
      await db.insertInto('email_templates').values({ kind: 'ORDER_CANCELLED', enabled: true, updated_by: adminId }).execute();
      const { account } = await ctx.services.auth.registerAccount({ email: 'pg-sender@example.com', password: PASSWORD, firstName: 'Camille', lastName: 'Martin', country: 'FR' });
      const sent: string[] = [];
      const config: Pick<AppConfig, 'email' | 'publicOrigin'> = { publicOrigin: ORIGIN, email: smtpConfig({ port: 1, user: 'u', password: 'p' }) };
      const senders = Array.from(
        { length: 4 },
        () =>
          new EmailService({
            db,
            config,
            unsubscribeKey: KEY,
            clock: clock.now,
            transport: async (e) => {
              await new Promise((r) => setTimeout(r, 2));
              sent.push(/Message-ID: <([^@]+)@/.exec(e.data)![1]!);
            },
          }),
      );
      for (let i = 0; i < 120; i++) await senders[0]!.enqueue(db, { kind: 'ORDER_CANCELLED', to: 'pg-sender@example.com', accountId: account.id, dedupeKey: `pg:${i}`, values: {} });
      let total = 0;
      for (let pass = 0; pass < 3; pass++) {
        const reports = await Promise.all(senders.map((s) => s.sendDue()));
        total += reports.reduce((n, r) => n + r.sent, 0);
      }
      expect(total).toBe(120);
      expect(sent).toHaveLength(120);
      expect(new Set(sent).size).toBe(120);
      const rows = await db.selectFrom('email_outbox').select(['status', 'attempts']).execute();
      expect(rows.every((r) => r.status === 'SENT' && r.attempts === 1)).toBe(true);
    } finally {
      await ctx.close();
    }
  });
});
