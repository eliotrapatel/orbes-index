/**
 * A local SMTP server for the tests (lot M1 plan §4.5): node:net, and node:tls with a self-signed certificate made
 * here (an ECDSA P-256 key and its X.509 certificate written in DER by hand: no file, no openssl). No test ever calls a
 * real provider.
 *
 *   const smtp = await startFakeSmtp({ security: 'starttls' });
 *   await sendSmtp({ host: 'localhost', port: smtp.port, security: 'starttls', user: smtp.user, password: smtp.password, ca: smtp.ca }, envelope);
 *   smtp.messages[0].data; // the message as the client meant it (dots unstuffed)
 *   await smtp.close();
 *
 * It speaks what the client needs: EHLO (STARTTLS offered before TLS on a `starttls` server; AUTH offered only over TLS,
 * except on an `unsafe` server, which offers AUTH in clear and never STARTTLS), STARTTLS, AUTH PLAIN and LOGIN, MAIL,
 * RCPT, DATA, QUIT. Each client line is kept (`transcript`) with whether it came over TLS. A reply can be replaced for
 * one step (`replies`), the greeting withheld (`silent`), or bytes sent before the TLS handshake (`injectBeforeTls`).
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { createServer as netServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { createSecureContext, createServer as tlsServer, TLSSocket } from 'node:tls';

// ── A self-signed certificate ──────────────────────────────────────────────

const len = (n: number): Buffer => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const tlv = (tag: number, body: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...parts: Buffer[]): Buffer => tlv(0x30, Buffer.concat(parts));
const set = (...parts: Buffer[]): Buffer => tlv(0x31, Buffer.concat(parts));
const integer = (b: Buffer): Buffer => tlv(0x02, b[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
const oid = (dotted: string): Buffer => {
  const [a, b, ...rest] = dotted.split('.').map(Number) as [number, number, ...number[]];
  const out = [40 * a + b];
  for (const arc of rest) {
    const chunk: number[] = [arc & 0x7f];
    for (let v = Math.floor(arc / 128); v > 0; v = Math.floor(v / 128)) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
};
const utcTime = (d: Date): Buffer => {
  const p = (n: number) => String(n).padStart(2, '0');
  return tlv(0x17, Buffer.from(`${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`, 'ascii'));
};
const name = (cn: string): Buffer => seq(set(seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(cn, 'utf8')))));
const pem = (label: string, der: Buffer): string => `-----BEGIN ${label}-----\n${der.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END ${label}-----\n`;

export interface SelfSigned {
  /** PEM of the certificate (also what a client trusts as its authority). */
  cert: string;
  /** PEM of the private key (PKCS #8). */
  key: string;
}

/** A self-signed certificate for these DNS names and IPv4 addresses, valid from an hour ago for a day. */
export function selfSigned(names: { dns?: string[]; ip?: string[] } = { dns: ['localhost'], ip: ['127.0.0.1'] }): SelfSigned {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const now = Date.now();
  const cn = names.dns?.[0] ?? names.ip?.[0] ?? 'fake-smtp';
  const altNames = [
    ...(names.dns ?? []).map((d) => tlv(0x82, Buffer.from(d, 'ascii'))),
    ...(names.ip ?? []).map((ip) => tlv(0x87, Buffer.from(ip.split('.').map(Number)))),
  ];
  const ecdsaSha256 = seq(oid('1.2.840.10045.4.3.2'));
  // A DER integer is minimal: a serial opening on 0x00 then a byte below 0x80 is refused (illegal padding), so its first
  // byte is never 0 (and stays below 0x80, positive without a padding byte).
  const serial = randomBytes(16);
  serial[0] = (serial[0]! & 0x7f) | 0x01;
  const tbs = seq(
    tlv(0xa0, integer(Buffer.from([2]))),
    integer(serial),
    ecdsaSha256,
    name(cn),
    seq(utcTime(new Date(now - 3_600_000)), utcTime(new Date(now + 86_400_000))),
    name(cn),
    publicKey.export({ type: 'spki', format: 'der' }),
    tlv(0xa3, seq(seq(oid('2.5.29.17'), tlv(0x04, seq(...altNames))))),
  );
  const signature = sign('sha256', tbs, privateKey as KeyObject);
  const der = seq(tbs, ecdsaSha256, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  return { cert: pem('CERTIFICATE', der), key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string };
}

// ── The server ─────────────────────────────────────────────────────────────

/** The steps whose reply a test may replace (a whole reply line, e.g. `550 5.1.1 No such user`). */
export type FakeSmtpStep = 'greeting' | 'mail' | 'rcpt' | 'data' | 'message' | 'auth';

export interface FakeSmtpOptions {
  /** `tls`: TLS from the first byte; `starttls`: STARTTLS offered; `unsafe`: neither, AUTH offered in clear. */
  security: 'tls' | 'starttls' | 'unsafe';
  certificate?: SelfSigned;
  user?: string;
  password?: string;
  /** The AUTH mechanisms offered (default PLAIN and LOGIN). */
  mechanisms?: ('PLAIN' | 'LOGIN')[];
  replies?: Partial<Record<FakeSmtpStep, string>>;
  /** Never greets (the client's timeout). */
  silent?: boolean;
  /** Sends a line in the same packet as STARTTLS's 220, before the handshake (RFC 3207 §6). */
  injectBeforeTls?: boolean;
}

export interface FakeSmtpMessage {
  from: string;
  to: string[];
  /** The message as the client meant it: dot-stuffing undone, without the end `.`. */
  data: string;
  /** The data as it came on the wire (dot-stuffed), without the end line. */
  wire: string;
  user: string | null;
  mechanism: string | null;
  overTls: boolean;
}

export interface FakeSmtp {
  port: number;
  /** The certificate a client trusts as its authority. */
  ca: string;
  user: string;
  password: string;
  messages: FakeSmtpMessage[];
  /** Every line a client sent, with whether it came over TLS. */
  transcript: { line: string; overTls: boolean }[];
  connections: number;
  close(): Promise<void>;
}

export async function startFakeSmtp(options: FakeSmtpOptions): Promise<FakeSmtp> {
  const certificate = options.certificate ?? selfSigned();
  const context = createSecureContext({ key: certificate.key, cert: certificate.cert });
  const user = options.user ?? 'orbes-smtp-user';
  const password = options.password ?? `pw-${randomBytes(9).toString('base64url')}`;
  const mechanisms = options.mechanisms ?? ['PLAIN', 'LOGIN'];
  const sockets = new Set<Socket>();
  const fake: FakeSmtp = { port: 0, ca: certificate.cert, user, password, messages: [], transcript: [], connections: 0, close: async () => {} };

  const session = (initial: Socket, startsOverTls: boolean) => {
    fake.connections += 1;
    let socket = initial;
    let overTls = startsOverTls;
    let buffer = '';
    let inData = false;
    let dataLines: string[] = [];
    let authed: { user: string; mechanism: string } | null = null;
    let login: 'user' | 'password' | null = null;
    let loginUser = '';
    let mail: { from: string; to: string[] } | null = null;
    const send = (line: string) => socket.write(`${line}\r\n`);
    const reply = (step: FakeSmtpStep, fallback: string) => send(options.replies?.[step] ?? fallback);

    const onLine = (line: string) => {
      if (inData) {
        if (line === '.') {
          inData = false;
          const wire = dataLines.join('\r\n');
          const data = dataLines.map((l) => (l.startsWith('.') ? l.slice(1) : l)).join('\r\n');
          if (!options.replies?.message || options.replies.message.startsWith('2')) {
            fake.messages.push({ from: mail!.from, to: mail!.to, data, wire, user: authed?.user ?? null, mechanism: authed?.mechanism ?? null, overTls });
          }
          dataLines = [];
          mail = null;
          reply('message', `250 2.0.0 Ok: queued as FAKE${fake.messages.length}`);
        } else {
          dataLines.push(line);
        }
        return;
      }
      fake.transcript.push({ line, overTls });
      if (login === 'user') {
        loginUser = Buffer.from(line, 'base64').toString('utf8');
        login = 'password';
        send('334 UGFzc3dvcmQ6');
        return;
      }
      if (login === 'password') {
        login = null;
        const ok = loginUser === user && Buffer.from(line, 'base64').toString('utf8') === password;
        if (ok) authed = { user: loginUser, mechanism: 'LOGIN' };
        reply('auth', ok ? '235 2.7.0 Authentication successful' : `535 5.7.8 Authentication failed for ${loginUser}`);
        return;
      }
      const [verb = '', ...rest] = line.split(' ');
      const arg = rest.join(' ');
      switch (verb.toUpperCase()) {
        case 'EHLO': {
          const ext = [
            ...(options.security === 'starttls' && !overTls ? ['STARTTLS'] : []),
            ...(overTls || options.security === 'unsafe' ? [`AUTH ${mechanisms.join(' ')}`] : []),
            'SIZE 10485760',
          ];
          const lines = ['fake.smtp.test', ...ext];
          lines.forEach((l, i) => send(`250${i === lines.length - 1 ? ' ' : '-'}${l}`));
          return;
        }
        case 'STARTTLS': {
          if (options.security !== 'starttls' || overTls) return send('502 5.5.1 Not here');
          socket.removeListener('data', onData);
          if (options.injectBeforeTls) socket.write('220 2.0.0 Ready\r\n250 injected\r\n');
          else send('220 2.0.0 Ready');
          const secure = new TLSSocket(socket, { isServer: true, secureContext: context });
          secure.on('error', () => {});
          sockets.add(secure);
          socket = secure;
          overTls = true;
          authed = null;
          buffer = '';
          secure.on('data', onData);
          return;
        }
        case 'AUTH': {
          const [mech = '', initial] = arg.split(' ');
          if (mech.toUpperCase() === 'PLAIN' && mechanisms.includes('PLAIN')) {
            const [, u = '', p = ''] = Buffer.from(initial ?? '', 'base64').toString('utf8').split('\u0000');
            const ok = u === user && p === password;
            if (ok) authed = { user: u, mechanism: 'PLAIN' };
            return reply('auth', ok ? '235 2.7.0 Authentication successful' : `535 5.7.8 Authentication failed for ${u}`);
          }
          if (mech.toUpperCase() === 'LOGIN' && mechanisms.includes('LOGIN')) {
            login = 'user';
            return send('334 VXNlcm5hbWU6');
          }
          return send('504 5.5.4 Unrecognized authentication type');
        }
        case 'MAIL': {
          if (!authed) return send('530 5.7.0 Authentication required');
          mail = { from: /^FROM:<([^>]*)>$/i.exec(arg)?.[1] ?? '', to: [] };
          return reply('mail', '250 2.1.0 Ok');
        }
        case 'RCPT': {
          if (!mail) return send('503 5.5.1 Need MAIL first');
          mail.to.push(/^TO:<([^>]*)>$/i.exec(arg)?.[1] ?? '');
          return reply('rcpt', '250 2.1.5 Ok');
        }
        case 'DATA': {
          if (!mail || mail.to.length === 0) return send('503 5.5.1 Need RCPT first');
          const answer = options.replies?.data ?? '354 End data with <CR><LF>.<CR><LF>';
          if (answer.startsWith('354')) inData = true;
          return send(answer);
        }
        case 'QUIT':
          send('221 2.0.0 Bye');
          socket.end();
          return;
        default:
          return send('500 5.5.2 Unknown command');
      }
    };

    function onData(chunk: Buffer) {
      buffer += chunk.toString('latin1');
      let at: number;
      while ((at = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        onLine(line);
      }
    }

    socket.on('data', onData);
    socket.on('error', () => {});
    if (!options.silent) reply('greeting', '220 fake.smtp.test ESMTP');
  };

  const server: Server =
    options.security === 'tls'
      ? tlsServer({ key: certificate.key, cert: certificate.cert }, (s) => {
          sockets.add(s);
          session(s, true);
        })
      : netServer((s) => {
          sockets.add(s);
          session(s, false);
        });
  server.on('tlsClientError', () => {});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.port = (server.address() as AddressInfo).port;
  fake.close = () =>
    new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
    });
  return fake;
}

/** A short fingerprint of a certificate (logs of a failing test). */
export const fingerprint = (cert: string): string => createHash('sha256').update(cert).digest('hex').slice(0, 12);
