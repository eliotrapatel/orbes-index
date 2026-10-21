/**
 * The emails' SMTP transport (lot M1 plan §4.1, §4.5; server/email/smtp.ts) against a local fake server
 * (test/support/fake-smtp.ts): TLS from the first byte and STARTTLS, AUTH PLAIN and LOGIN, the certificate always
 * verified (a self-signed one is refused unless the test names it as its authority, and a wrong name is refused even
 * then), no credential in clear, no header injection, dot-stuffing, the timeouts, and the MIME message.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildMessage,
  dotStuff,
  encodeWords,
  quotedPrintable,
  rfc5322Date,
  sendSmtp,
  SmtpError,
  type MailMessage,
  type SmtpOptions,
} from '../../src/server/email/smtp.js';
import { selfSigned, startFakeSmtp, type FakeSmtp, type FakeSmtpOptions } from '../support/fake-smtp.js';

const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'server', 'email', 'smtp.ts'), 'utf8');

let servers: FakeSmtp[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

async function server(options: FakeSmtpOptions): Promise<FakeSmtp> {
  const s = await startFakeSmtp(options);
  servers.push(s);
  return s;
}

const optionsFor = (s: FakeSmtp, security: 'tls' | 'starttls', extra: Partial<SmtpOptions> = {}): SmtpOptions => ({
  host: 'localhost',
  port: s.port,
  security,
  user: s.user,
  password: s.password,
  clientName: 'verify.orbes.test',
  ca: s.ca,
  timeouts: { connectMs: 3_000, commandMs: 3_000, dataMs: 3_000 },
  ...extra,
});

const message = (over: Partial<MailMessage> = {}): MailMessage => ({
  from: { address: 'hello@theorbes.com', name: 'ORBES' },
  to: 'camille@example.com',
  replyTo: 'clientservices@theorbes.com',
  subject: 'Your order OR-7F3A21C9 is confirmed',
  text: 'Camille,\n\nYour order is confirmed.\n.\nA line that starts with a dot.',
  html: '<p>Camille,</p>\n.<p>dot</p>',
  id: '6f1c2b0e-5d0a-4c1b-9b7e-2f8e4d3c1a00',
  date: new Date('2026-10-21T07:50:00.000Z'),
  ...over,
});

const envelope = (data = buildMessage(message())) => ({ from: 'hello@theorbes.com', to: 'camille@example.com', data });

/** Decodes quoted-printable (the fake's view of a part). */
const unQp = (s: string): string =>
  Buffer.from(
    s
      .replace(/=\r\n/g, '')
      .replace(/=([0-9A-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
      .split('')
      .map((c) => c.charCodeAt(0)),
  ).toString('utf8');

describe('sendSmtp, against the fake server', () => {
  it('sends over TLS from the first byte (465) with AUTH PLAIN, the data dot-stuffed on the wire and whole at the other end', async () => {
    const s = await server({ security: 'tls' });
    const data = buildMessage(message());
    const r = await sendSmtp(optionsFor(s, 'tls'), envelope(data));
    expect(r.reply).toMatch(/queued as FAKE1/);
    expect(s.messages).toHaveLength(1);
    const m = s.messages[0]!;
    expect(m).toMatchObject({ from: 'hello@theorbes.com', to: ['camille@example.com'], user: s.user, mechanism: 'PLAIN', overTls: true });
    // Dot-stuffing: the line « . » of the text travels as « .. », and arrives as it was written.
    expect(data).toMatch(/\r\n\.\r\n/);
    expect(m.wire).toContain('\r\n..\r\n');
    expect(`${m.data}\r\n`).toBe(data);
    // Every client line went over TLS; EHLO named the platform.
    expect(s.transcript.every((t) => t.overTls)).toBe(true);
    expect(s.transcript[0]!.line).toBe('EHLO verify.orbes.test');
    expect(s.transcript.map((t) => t.line.split(' ')[0])).toEqual(['EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT']);
  });

  it('upgrades with STARTTLS (587) before any credential, then says EHLO again; AUTH LOGIN when only LOGIN is offered', async () => {
    const s = await server({ security: 'starttls', mechanisms: ['LOGIN'] });
    await sendSmtp(optionsFor(s, 'starttls'), envelope());
    expect(s.messages[0]).toMatchObject({ mechanism: 'LOGIN', overTls: true });
    const lines = s.transcript.map((t) => `${t.overTls ? 'tls' : 'clear'} ${t.line.split(' ')[0]}`);
    expect(lines.slice(0, 4)).toEqual(['clear EHLO', 'clear STARTTLS', 'tls EHLO', 'tls AUTH']);
    // The password never crossed in clear, nor in any encoding the transcript holds outside TLS.
    const clear = s.transcript.filter((t) => !t.overTls).map((t) => t.line).join('\n');
    for (const secret of [s.password, Buffer.from(s.password).toString('base64'), s.user]) expect(clear).not.toContain(secret);
  });

  it('refuses a server that does not offer STARTTLS, before any credential or message is sent', async () => {
    const s = await server({ security: 'unsafe' });
    const e = await sendSmtp(optionsFor(s, 'starttls'), envelope()).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(SmtpError);
    expect(e).toMatchObject({ stage: 'starttls', code: 0, permanent: false });
    expect(s.transcript.map((t) => t.line)).toEqual(['EHLO verify.orbes.test']);
    expect(s.messages).toEqual([]);
  });

  it('refuses bytes the server sends before the STARTTLS handshake (RFC 3207 §6)', async () => {
    const s = await server({ security: 'starttls', injectBeforeTls: true });
    await expect(sendSmtp(optionsFor(s, 'starttls'), envelope())).rejects.toMatchObject({ stage: 'starttls', message: expect.stringMatching(/before the handshake/) });
    expect(s.messages).toEqual([]);
  });

  it('always verifies the certificate: a self-signed one is refused unless it is the authority given, and a wrong name is refused even then', async () => {
    const tls = await server({ security: 'tls' });
    const starttls = await server({ security: 'starttls' });
    const { ca: _ca, ...noCa } = optionsFor(tls, 'tls');
    await expect(sendSmtp(noCa, envelope())).rejects.toMatchObject({ stage: 'connect', message: expect.stringMatching(/self.signed|certificate/i) });
    const { ca: _ca2, ...noCa2 } = optionsFor(starttls, 'starttls');
    await expect(sendSmtp(noCa2, envelope())).rejects.toMatchObject({ stage: 'starttls', message: expect.stringMatching(/self.signed|certificate/i) });
    // A certificate the client trusts, for another name.
    const other = await server({ security: 'tls', certificate: selfSigned({ dns: ['mail.other.test'] }) });
    await expect(sendSmtp(optionsFor(other, 'tls'), envelope())).rejects.toMatchObject({ stage: 'connect', message: expect.stringMatching(/altnames|does not match|hostname/i) });
    // An IP address is checked against the certificate's addresses.
    await expect(sendSmtp(optionsFor(tls, 'tls', { host: '127.0.0.1' }), envelope())).resolves.toMatchObject({ reply: expect.any(String) });
    expect(tls.messages).toHaveLength(1);
    expect(starttls.messages).toEqual([]);
    expect(other.messages).toEqual([]);
    // No switch turns verification off.
    expect(SOURCE).not.toMatch(/rejectUnauthorized:\s*false|NODE_TLS_REJECT_UNAUTHORIZED|checkServerIdentity/);
    expect(SOURCE).toMatch(/rejectUnauthorized: true/);
  });

  it('names the step and the code of a refusal, without the credentials; only a 5xx to the address or the message is permanent', async () => {
    const wrong = await server({ security: 'tls' });
    const e = (await sendSmtp({ ...optionsFor(wrong, 'tls'), password: 'not-the-password-123' }, envelope()).catch((err: unknown) => err)) as SmtpError;
    expect(e).toMatchObject({ stage: 'auth', code: 535, permanent: false });
    // The fake echoes the user in its refusal: it is cleared from the words kept.
    expect(e.message).toContain('[redacted]');
    expect(e.message).not.toContain(wrong.user);
    expect(e.message).not.toContain('not-the-password-123');

    const unknown = await server({ security: 'tls', replies: { rcpt: '550 5.1.1 <camille@example.com>: Recipient address rejected' } });
    await expect(sendSmtp(optionsFor(unknown, 'tls'), envelope())).rejects.toMatchObject({ stage: 'rcpt', code: 550, permanent: true });
    const busy = await server({ security: 'tls', replies: { message: '451 4.3.0 Try again later' } });
    await expect(sendSmtp(optionsFor(busy, 'tls'), envelope())).rejects.toMatchObject({ stage: 'message', code: 451, permanent: false });
    const sender = await server({ security: 'tls', replies: { mail: '553 5.7.1 Sender not allowed' } });
    await expect(sendSmtp(optionsFor(sender, 'tls'), envelope())).rejects.toMatchObject({ stage: 'mail', code: 553, permanent: false });
    expect(unknown.messages).toEqual([]);
  });

  it('gives up on a silent server within its timeout, and on a closed port at once', async () => {
    const silent = await server({ security: 'starttls', silent: true });
    const started = Date.now();
    await expect(sendSmtp(optionsFor(silent, 'starttls', { timeouts: { commandMs: 300 } }), envelope())).rejects.toMatchObject({
      stage: 'greeting',
      code: 0,
      message: expect.stringMatching(/did not answer in time/),
    });
    expect(Date.now() - started).toBeLessThan(2_500);
    const closed = await server({ security: 'starttls' });
    const port = closed.port;
    await closed.close();
    servers = servers.filter((s) => s !== closed);
    await expect(sendSmtp({ ...optionsFor(closed, 'starttls'), port }, envelope())).rejects.toMatchObject({ stage: 'connect', code: 0 });
  });

  it('refuses an envelope address that could break a command, and a message with a bare CR or LF', async () => {
    const s = await server({ security: 'tls' });
    for (const to of ['camille@example.com\r\nRCPT TO:<x@evil.test>', 'camille@example.com>', 'Camille <camille@example.com>', 'camille', 'cämille@example.com']) {
      await expect(sendSmtp(optionsFor(s, 'tls'), { ...envelope(), to }), to).rejects.toMatchObject({ stage: 'input' });
    }
    await expect(sendSmtp(optionsFor(s, 'tls'), envelope('Subject: x\r\n\r\nline\nbare LF\r\n'))).rejects.toMatchObject({ stage: 'input' });
    await expect(sendSmtp(optionsFor(s, 'tls'), envelope('Subject: x\r\n\r\nline\rbare CR\r\n'))).rejects.toMatchObject({ stage: 'input' });
    expect(s.connections).toBe(0);
  });
});

describe('buildMessage', () => {
  it('writes multipart/alternative, text then HTML, UTF-8 in quoted-printable, with Date, Message-ID and Reply-To', () => {
    const data = buildMessage(message({ subject: 'Votre commande · confirmée', text: 'Café — à bientôt' }));
    const [head, ...rest] = data.split('\r\n\r\n');
    const headers = head!.split('\r\n');
    expect(headers).toEqual(
      expect.arrayContaining([
        'From: ORBES <hello@theorbes.com>',
        'To: <camille@example.com>',
        'Reply-To: <clientservices@theorbes.com>',
        'Date: Wed, 21 Oct 2026 07:50:00 +0000',
        'Message-ID: <6f1c2b0e-5d0a-4c1b-9b7e-2f8e4d3c1a00@theorbes.com>',
        'MIME-Version: 1.0',
      ]),
    );
    expect(headers.find((h) => h.startsWith('Subject:'))).toBe(`Subject: ${encodeWords('Votre commande · confirmée')}`);
    expect(Buffer.from(/=\?UTF-8\?B\?([^?]+)\?=/.exec(head!)![1]!, 'base64').toString('utf8')).toContain('Votre commande');
    const boundary = /boundary="([^"]+)"/.exec(head!)![1]!;
    const body = rest.join('\r\n\r\n');
    const parts = body.split(`--${boundary}`);
    expect(parts).toHaveLength(4); // before, text, html, the end « -- »
    expect(parts[1]).toMatch(/^\r\nContent-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n/);
    expect(parts[2]).toMatch(/^\r\nContent-Type: text\/html; charset=utf-8\r\n/);
    expect(parts[3]).toBe('--\r\n');
    expect(unQp(parts[1]!.split('\r\n\r\n')[1]!.replace(/\r\n$/, ''))).toBe('Café — à bientôt');
    // 7-bit, CRLF only, no line over 998 characters.
    expect(/^[\x00-\x7f]*$/.test(data)).toBe(true);
    expect(data.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(Math.max(...data.split('\r\n').map((l) => l.length))).toBeLessThanOrEqual(78);
    // Without List-Unsubscribe unless asked.
    expect(data).not.toMatch(/List-Unsubscribe/);
  });

  it('adds List-Unsubscribe and its one-click POST (RFC 8058) to an email one may stop', () => {
    const data = buildMessage(message({ unsubscribe: { oneClick: 'https://verify.theorbes.com/api/v1/email/unsubscribe?t=f.x.y' } }));
    expect(data).toContain('\r\nList-Unsubscribe: <https://verify.theorbes.com/api/v1/email/unsubscribe?t=f.x.y>\r\n');
    expect(data).toContain('\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n');
    expect(() => buildMessage(message({ unsubscribe: { oneClick: 'http://verify.theorbes.com/u' } }))).toThrow(SmtpError);
  });

  it('refuses a line break or a control character in any header value (no header injection)', () => {
    const bad: Partial<MailMessage>[] = [
      { subject: 'Hello\r\nBcc: everyone@example.com' },
      { subject: 'Hello\nBcc: x@example.com' },
      { subject: 'Hello\u0000' },
      { subject: 'Hello\u2028there' },
      { to: 'camille@example.com\r\nBcc: x@example.com' },
      { replyTo: 'a@example.com\nBcc: x@example.com' },
      { from: { address: 'hello@theorbes.com', name: 'ORBES\r\nBcc: x@example.com' } },
      { from: { address: 'hello@theorbes.com>\r\nBcc: <x@example.com', name: null } },
      { id: 'abc\r\nBcc: x' },
      { unsubscribe: { oneClick: 'https://verify.theorbes.com/u\r\nBcc: x@example.com' } },
    ];
    for (const over of bad) expect(() => buildMessage(message(over)), JSON.stringify(over)).toThrow(SmtpError);
    // A name with a special character is quoted; one that is not ASCII is encoded.
    expect(buildMessage(message({ from: { address: 'hello@theorbes.com', name: 'ORBES, Paris' } }))).toContain('From: "ORBES, Paris" <hello@theorbes.com>');
    expect(buildMessage(message({ from: { address: 'hello@theorbes.com', name: 'ORBES Café' } }))).toMatch(/From: =\?UTF-8\?B\?[^?]+\?= <hello@theorbes.com>/);
  });

  it('quoted-printable keeps lines under 77 characters, escapes =, and never leaves a space at a line end', () => {
    const long = `${'é'.repeat(60)} = end `;
    const qp = quotedPrintable(`${long}\nnext`);
    for (const line of qp.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(76);
      expect(line).not.toMatch(/[ \t]$/);
    }
    expect(unQp(qp)).toBe(`${long}\r\nnext`);
    expect(quotedPrintable('a=b')).toBe('a=3Db');
  });

  it('dotStuff doubles a leading dot, ends with « . », and RFC 5322 dates are in UTC', () => {
    expect(dotStuff('a\r\n.b\r\n..c\r\n')).toBe('a\r\n..b\r\n...c\r\n.\r\n');
    expect(dotStuff('a')).toBe('a\r\n.\r\n');
    expect(rfc5322Date(new Date('2026-03-01T23:05:09Z'))).toBe('Sun, 1 Mar 2026 23:05:09 +0000');
  });
});
