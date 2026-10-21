/**
 * The emails' transport (macro scope E0; lot M1 plan §4.1): a minimal SMTP client on node:net and node:tls, provider
 * neutral (every provider offers SMTP: no SDK, no dependency), and the MIME message it carries.
 *
 * One message per connection, in order: the greeting, EHLO, STARTTLS and EHLO again (`starttls`, port 587) or TLS from
 * the first byte (`tls`, port 465), AUTH PLAIN (or LOGIN when only that is offered), MAIL FROM, RCPT TO, DATA, QUIT.
 *  - The server's certificate is always verified against the host's name (`rejectUnauthorized` is never false; a test
 *    may only add its own authority, `ca`); TLS 1.2 at least. A server that does not offer STARTTLS is refused before
 *    anything is sent: neither the credentials nor a message ever travel in clear.
 *  - Every step has its timeout (SMTP_TIMEOUTS); a reply longer than SMTP_REPLY_MAX is refused.
 *  - A carriage return or a line feed in a header value, an address or the envelope is refused (no header injection);
 *    the data is dot-stuffed and must use CRLF line ends only.
 *  - Errors (SmtpError) name the step and the server's reply code, with its words cut and cleared of the user and the
 *    password: never a credential, never the message.
 *
 * buildMessage writes the message: multipart/alternative (the plain text first, then the HTML), UTF-8 in
 * quoted-printable, the subject and the sender's name in RFC 2047 words when they are not plain ASCII, Date,
 * Message-ID, and on an email one may stop, `List-Unsubscribe` with `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 * (RFC 8058).
 *
 * The server's only outgoing client (docs/legal/TERMS-FACTS.md N1, N10): no fetch, no http.request.
 */
import { randomBytes } from 'node:crypto';
import { connect as netConnect, isIP, type Socket } from 'node:net';
import { connect as tlsConnect, type ConnectionOptions } from 'node:tls';
import type { SmtpSecurity } from '../config.js';

/** How long each step may take (ms): the connection with its TLS handshake, a command's reply, the end of the data. */
export const SMTP_TIMEOUTS: Readonly<{ connectMs: number; commandMs: number; dataMs: number }> = Object.freeze({ connectMs: 15_000, commandMs: 30_000, dataMs: 60_000 });
/** A reply from the server, at most (bytes, every line of a multi-line reply together). */
export const SMTP_REPLY_MAX = 16 * 1024;
/** A message, at most (bytes, before dot-stuffing). */
export const SMTP_MESSAGE_MAX = 1024 * 1024;

/** An address as an envelope or a header carries it: plain ASCII, one `@`, a dotted domain (config.ts's pattern). */
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})+$/;

export interface SmtpOptions {
  host: string;
  port: number;
  security: SmtpSecurity;
  user: string;
  password: string;
  /** The name this server gives in EHLO (the platform's host). */
  clientName?: string;
  /** Extra certificate authorities to trust (tests: the fake server's own). Verification itself is never turned off. */
  ca?: string | Buffer | Array<string | Buffer>;
  timeouts?: Partial<typeof SMTP_TIMEOUTS>;
}

/** What goes to the server: the envelope's two addresses and the whole message (buildMessage). */
export interface SmtpEnvelope {
  from: string;
  to: string;
  data: string;
}

/** The step an SMTP error happened at. */
export type SmtpStage = 'input' | 'connect' | 'greeting' | 'ehlo' | 'starttls' | 'auth' | 'mail' | 'rcpt' | 'data' | 'message' | 'quit';

/**
 * A refused or failed send. `code` is the server's reply code (0 when there was none: a network error, a timeout, a
 * refused certificate). `permanent`: the server refused this message or this address for good (a 5xx reply to RCPT TO,
 * DATA or the message), or the message could not even be written (`input`: the same refusal on every try); every other
 * failure may pass (a 4xx reply, the network, the credentials until they are fixed).
 */
export class SmtpError extends Error {
  override readonly name = 'SmtpError';
  constructor(
    readonly stage: SmtpStage,
    readonly code: number,
    message: string,
  ) {
    super(message);
  }

  get permanent(): boolean {
    if (this.stage === 'input') return true;
    return this.code >= 500 && this.code < 600 && (this.stage === 'rcpt' || this.stage === 'data' || this.stage === 'message');
  }
}

/** Whether `s` holds a carriage return, a line feed or another control character (never in a header or an address). */
export const hasControl = (s: string): boolean => /[\p{Cc}\u2028\u2029]/u.test(s);

/** Whether `s` is an address the envelope and the headers may carry. */
export function isMailAddress(s: string): boolean {
  return s.length <= 254 && ADDRESS.test(s);
}

// ── The message ────────────────────────────────────────────────────────────

export interface MailMessage {
  from: { address: string; name: string | null };
  to: string;
  replyTo?: string | null;
  subject: string;
  text: string;
  html: string;
  /** The Message-ID's unique part (the outbox row's id: the same on every attempt). */
  id: string;
  date: Date;
  /** On an email one may stop (E1, E2): the one-click address (RFC 8058, POST) and the page. */
  unsubscribe?: { oneClick: string } | null;
}

/** The message, ready for DATA: CRLF line ends, 7-bit, every header value checked. */
export function buildMessage(m: MailMessage): string {
  for (const [name, value] of [
    ['from', m.from.address],
    ['to', m.to],
    ...(m.replyTo ? [['reply-to', m.replyTo] as const] : []),
  ] as const) {
    if (!isMailAddress(value)) throw new SmtpError('input', 0, `${name}: not an address`);
  }
  for (const [name, value] of [
    ['subject', m.subject],
    ['from name', m.from.name ?? ''],
    ['id', m.id],
    ['unsubscribe', m.unsubscribe?.oneClick ?? ''],
  ] as const) {
    if (hasControl(value)) throw new SmtpError('input', 0, `${name}: a line break or a control character`);
  }
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(m.id)) throw new SmtpError('input', 0, 'id: letters, digits, . _ - only');
  if (m.unsubscribe && !/^https:\/\/[^\s<>"]+$/.test(m.unsubscribe.oneClick)) throw new SmtpError('input', 0, 'unsubscribe: an https address');
  const domain = m.from.address.slice(m.from.address.lastIndexOf('@') + 1);
  const boundary = `=_orbes_${randomBytes(8).toString('hex')}`;
  const headers = [
    `From: ${m.from.name ? `${displayName(m.from.name)} ` : ''}<${m.from.address}>`,
    `To: <${m.to}>`,
    ...(m.replyTo ? [`Reply-To: <${m.replyTo}>`] : []),
    foldHeader('Subject', encodeWords(m.subject)),
    `Date: ${rfc5322Date(m.date)}`,
    `Message-ID: <${m.id}@${domain}>`,
    'MIME-Version: 1.0',
    ...(m.unsubscribe ? [`List-Unsubscribe: <${m.unsubscribe.oneClick}>`, 'List-Unsubscribe-Post: List-Unsubscribe=One-Click'] : []),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type: string, body: string) => [`--${boundary}`, `Content-Type: ${type}; charset=utf-8`, 'Content-Transfer-Encoding: quoted-printable', '', quotedPrintable(body)];
  const lines = [...headers, '', ...part('text/plain', m.text), ...part('text/html', m.html), `--${boundary}--`, ''];
  return lines.join('\r\n');
}

/** A sender's name: kept as it is when plain, quoted when it holds a special character, RFC 2047 when not ASCII. */
function displayName(name: string): string {
  if (/^[A-Za-z0-9 !#$%&'*+/=?^_`{|}~-]+$/.test(name)) return name;
  if (/^[\x20-\x7e]+$/.test(name)) return `"${name.replace(/(["\\])/g, '\\$1')}"`;
  return encodeWords(name);
}

/** A header value in RFC 2047 encoded words (base64, UTF-8) when it is not plain printable ASCII. */
export function encodeWords(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value) && !value.includes('=?')) return value;
  // Encoded words of 64 characters at most (39 bytes of UTF-8, 52 in base64), so `Subject: ` and one word fit a line of
  // 78; a character is never split.
  const words: string[] = [];
  let chunk = '';
  for (const ch of value) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > 39) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk !== '') words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join(' ');
}

/** `Name: value`, folded on spaces so that no line passes 78 characters where it can be helped. */
function foldHeader(name: string, value: string): string {
  const out: string[] = [];
  let line = `${name}:`;
  for (const word of value.split(' ')) {
    if (line.length + 1 + word.length > 78 && line.length > name.length + 1) {
      out.push(line);
      line = ` ${word}`;
    } else {
      line += ` ${word}`;
    }
  }
  out.push(line);
  return out.join('\r\n');
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** RFC 5322's date, in UTC: `Tue, 21 Oct 2026 07:50:00 +0000`. */
export function rfc5322Date(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

/** Quoted-printable (RFC 2045) of UTF-8 text: CRLF line ends, lines of at most 76 characters. */
export function quotedPrintable(text: string): string {
  const out: string[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const bytes = Buffer.from(line, 'utf8');
    let encoded = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]!;
      const last = i === bytes.length - 1;
      const literal = (b >= 33 && b <= 126 && b !== 61) || ((b === 32 || b === 9) && !last);
      const token = literal ? String.fromCharCode(b) : `=${b.toString(16).toUpperCase().padStart(2, '0')}`;
      // A soft line break (`=` at the end) before the line would pass 76 characters.
      const lineLength = encoded.length - encoded.lastIndexOf('\n') - 1;
      if (lineLength + token.length > 75) encoded += '=\r\n';
      encoded += token;
    }
    out.push(encoded);
  }
  return out.join('\r\n');
}

// ── The conversation ───────────────────────────────────────────────────────

interface Reply {
  code: number;
  lines: string[];
}

/** Reads the server's replies off a socket, one complete (possibly multi-line) reply at a time. */
class ReplyReader {
  private buffer = Buffer.alloc(0);
  private lines: string[] = [];
  private readonly ready: Reply[] = [];
  private waiting: { resolve: (r: Reply) => void; reject: (e: Error) => void } | null = null;
  private failure: Error | null = null;
  private socket: Socket | null = null;
  private readonly onData = (chunk: Buffer) => this.push(chunk);
  private readonly onError = (err: Error) => this.fail(err);
  private readonly onClose = () => this.fail(new Error('the server closed the connection'));

  attach(socket: Socket): void {
    this.detach();
    this.socket = socket;
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
  }

  detach(): void {
    if (!this.socket) return;
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('close', this.onClose);
    this.socket = null;
  }

  /** Whether bytes the server sent are still unread (never before STARTTLS's handshake: RFC 3207 §6). */
  get pending(): boolean {
    return this.buffer.length > 0 || this.lines.length > 0 || this.ready.length > 0;
  }

  next(): Promise<Reply> {
    const r = this.ready.shift();
    if (r) return Promise.resolve(r);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
    });
  }

  fail(err: Error): void {
    if (this.failure) return;
    this.failure = err;
    const w = this.waiting;
    this.waiting = null;
    w?.reject(err);
  }

  private push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const pendingBytes = this.buffer.length + this.lines.reduce((n, l) => n + l.length, 0);
    if (pendingBytes > SMTP_REPLY_MAX) {
      this.fail(new Error('the server’s reply is too long'));
      return;
    }
    let at: number;
    while ((at = this.buffer.indexOf('\r\n')) >= 0) {
      const line = this.buffer.subarray(0, at).toString('latin1');
      this.buffer = this.buffer.subarray(at + 2);
      const m = /^(\d{3})([ -]?)(.*)$/.exec(line);
      if (!m) {
        this.fail(new Error('the server’s reply is not SMTP'));
        return;
      }
      this.lines.push(m[3]!);
      if (m[2] !== '-') {
        const reply = { code: Number(m[1]), lines: this.lines };
        this.lines = [];
        const w = this.waiting;
        this.waiting = null;
        if (w) w.resolve(reply);
        else this.ready.push(reply);
      }
    }
  }
}

/**
 * Sends one message over one connection and closes it. Resolves with the server's reply to the data (its queue id, as
 * the server words it); rejects with an SmtpError.
 */
export async function sendSmtp(options: SmtpOptions, envelope: SmtpEnvelope): Promise<{ reply: string }> {
  const timeouts = { ...SMTP_TIMEOUTS, ...options.timeouts };
  if (!isMailAddress(envelope.from)) throw new SmtpError('input', 0, 'from: not an address');
  if (!isMailAddress(envelope.to)) throw new SmtpError('input', 0, 'to: not an address');
  const data = dotStuff(envelope.data);
  const clientName = options.clientName ?? 'localhost';
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(clientName)) throw new SmtpError('input', 0, 'client name: a host name');

  const scrub = (words: string): string => {
    let s = words.replace(/[\p{Cc}]/gu, ' ');
    for (const secret of [options.password, options.user]) if (secret) s = s.split(secret).join('[redacted]');
    return s.slice(0, 200).trim();
  };
  const reader = new ReplyReader();
  let socket: Socket | null = null;
  let stage: SmtpStage = 'connect';

  const tlsOptions = (base: ConnectionOptions): ConnectionOptions => ({
    ...base,
    // The name the certificate must carry (an IP address is checked against the certificate's IP addresses instead).
    ...(isIP(options.host) === 0 ? { servername: options.host } : {}),
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
    ...(options.ca !== undefined ? { ca: options.ca } : {}),
  });

  /** Waits for a socket's connection (and TLS handshake), within the connection's timeout. */
  const opened = <S extends Socket>(s: S, event: 'connect' | 'secureConnect'): Promise<S> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        s.destroy();
        reject(new Error('the connection timed out'));
      }, timeouts.connectMs);
      s.once(event, () => {
        clearTimeout(timer);
        resolve(s);
      });
      s.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

  /** The next reply within `ms`; refused unless its code is one of `expected`. */
  const expect = async (expected: number[], ms: number = timeouts.commandMs): Promise<Reply> => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('the server did not answer in time')), ms);
    });
    try {
      const reply = await Promise.race([reader.next(), timeout]);
      if (!expected.includes(reply.code)) throw new SmtpError(stage, reply.code, `${stage}: ${reply.code} ${scrub(reply.lines.join(' '))}`);
      return reply;
    } finally {
      clearTimeout(timer);
    }
  };
  const write = (line: string) => {
    socket!.write(`${line}\r\n`);
  };
  const command = async (line: string, expected: number[], ms?: number) => {
    write(line);
    return expect(expected, ms);
  };

  try {
    if (options.security === 'tls') {
      socket = await opened(tlsConnect(tlsOptions({ host: options.host, port: options.port })), 'secureConnect');
    } else {
      socket = await opened(netConnect({ host: options.host, port: options.port }), 'connect');
    }
    reader.attach(socket);
    stage = 'greeting';
    await expect([220]);
    stage = 'ehlo';
    let ehlo = await command(`EHLO ${clientName}`, [250]);
    if (options.security === 'starttls') {
      stage = 'starttls';
      if (!offers(ehlo, 'STARTTLS')) throw new SmtpError('starttls', 0, 'starttls: the server does not offer STARTTLS');
      await command('STARTTLS', [220]);
      // Nothing the server sent before the handshake may be read as if it came over TLS (RFC 3207 §6).
      if (reader.pending) throw new SmtpError('starttls', 0, 'starttls: the server sent data before the handshake');
      reader.detach();
      const plain = socket;
      // Its errors reach the TLS socket above it; this one only keeps them from being unhandled.
      plain.on('error', () => {});
      socket = await opened(tlsConnect(tlsOptions({ socket: plain })), 'secureConnect');
      reader.attach(socket);
      stage = 'ehlo';
      ehlo = await command(`EHLO ${clientName}`, [250]);
    }
    stage = 'auth';
    const mechanisms = authMechanisms(ehlo);
    if (mechanisms.has('PLAIN')) {
      const token = Buffer.from(`\u0000${options.user}\u0000${options.password}`, 'utf8').toString('base64');
      await command(`AUTH PLAIN ${token}`, [235]);
    } else if (mechanisms.has('LOGIN')) {
      await command('AUTH LOGIN', [334]);
      await command(Buffer.from(options.user, 'utf8').toString('base64'), [334]);
      await command(Buffer.from(options.password, 'utf8').toString('base64'), [235]);
    } else {
      throw new SmtpError('auth', 0, 'auth: the server offers neither PLAIN nor LOGIN');
    }
    stage = 'mail';
    await command(`MAIL FROM:<${envelope.from}>`, [250]);
    stage = 'rcpt';
    await command(`RCPT TO:<${envelope.to}>`, [250, 251]);
    stage = 'data';
    await command('DATA', [354]);
    stage = 'message';
    socket.write(data);
    const done = await expect([250], timeouts.dataMs);
    stage = 'quit';
    // QUIT is a courtesy: the message is accepted whatever its answer.
    try {
      await command('QUIT', [221], 2_000);
    } catch {
      /* the message is already accepted */
    }
    return { reply: scrub(done.lines.join(' ')) };
  } catch (e) {
    if (e instanceof SmtpError) throw e;
    const message = (e as Error)?.message ?? 'failed';
    throw new SmtpError(stage, 0, `${stage}: ${scrub(message)}`);
  } finally {
    reader.detach();
    socket?.destroy();
  }
}

/** Whether an EHLO reply offers an extension (its keyword, any case). */
function offers(ehlo: Reply, keyword: string): boolean {
  return ehlo.lines.slice(1).some((l) => l.trim().split(/\s+/)[0]?.toUpperCase() === keyword);
}

/** The AUTH mechanisms an EHLO reply offers. */
function authMechanisms(ehlo: Reply): Set<string> {
  const out = new Set<string>();
  for (const l of ehlo.lines.slice(1)) {
    const [keyword, ...rest] = l.trim().split(/\s+/);
    if (keyword?.toUpperCase() === 'AUTH') for (const m of rest) out.add(m.toUpperCase());
  }
  return out;
}

/**
 * The message as DATA carries it: CRLF line ends only (a lone CR or LF is refused), each line that starts with a dot
 * doubled (RFC 5321 §4.5.2), then the end `.`.
 */
export function dotStuff(data: string): string {
  if (Buffer.byteLength(data, 'utf8') > SMTP_MESSAGE_MAX) throw new SmtpError('input', 0, 'message: too long');
  const lines = data.split('\r\n');
  if (lines.some((l) => l.includes('\r') || l.includes('\n'))) throw new SmtpError('input', 0, 'message: a bare CR or LF');
  if (lines.at(-1) === '') lines.pop();
  return `${lines.map((l) => (l.startsWith('.') ? `.${l}` : l)).join('\r\n')}\r\n.\r\n`;
}
