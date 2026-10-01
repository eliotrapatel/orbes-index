import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DomainError } from '../../src/server/errors.js';
import { canonicalIp, ipHashOf, pseudonymize, rateLimitKeyOf, userAgentFamily } from '../../src/server/http/client.js';
import { mapError, zodMessage } from '../../src/server/http/errors.js';
import { createForwardingLogger, loggerOptions } from '../../src/server/http/logging.js';
import { body, emptyBody, pageOf, parse, productRef, verifyBody } from '../../src/server/http/schemas.js';
import { hasRole, originAllowed } from '../../src/server/http/sessions.js';
import { safeFilename } from '../../src/server/routes/admin/codes.js';
import { escapeLike } from '../../src/server/routes/admin/products.js';

const PEPPER = 'p'.repeat(40);

describe('client pseudonyms', () => {
  it('are keyed, domain-separated and never contain the input', () => {
    const ip = pseudonymize(PEPPER, 'ip', '203.0.113.7');
    expect(ip).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ip).not.toContain('203');
    expect(pseudonymize(PEPPER, 'device', '203.0.113.7')).not.toBe(ip);
    expect(pseudonymize('q'.repeat(40), 'ip', '203.0.113.7')).not.toBe(ip);
    expect(pseudonymize(PEPPER, 'ip', '203.0.113.7')).toBe(ip);
  });

  it('canonicalises IPv4-mapped IPv6 so both spellings hash alike', () => {
    expect(canonicalIp('::ffff:198.51.100.9')).toBe('198.51.100.9');
    expect(ipHashOf(PEPPER, { ip: '::ffff:198.51.100.9' })).toBe(ipHashOf(PEPPER, { ip: '198.51.100.9' }));
    expect(canonicalIp(undefined)).toBe('unknown');
  });

  it('groups IPv6 rate-limit keys by /64 only', () => {
    expect(rateLimitKeyOf(PEPPER, { ip: '2001:db8:1:2::1' })).toBe(rateLimitKeyOf(PEPPER, { ip: '2001:db8:1:2:ffff::9' }));
    expect(rateLimitKeyOf(PEPPER, { ip: '2001:db8:1:3::1' })).not.toBe(rateLimitKeyOf(PEPPER, { ip: '2001:db8:1:2::1' }));
    expect(ipHashOf(PEPPER, { ip: '2001:db8:1:2::1' })).not.toBe(ipHashOf(PEPPER, { ip: '2001:db8:1:2::2' }));
  });

  it('reduces user agents to a coarse family', () => {
    const cases: [string, string][] = [
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', 'Safari/iOS'],
      ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36', 'Chrome/Android'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0', 'Edge/Windows'],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0', 'Firefox/macOS'],
      ['curl/8.5.0', 'Bot/Other'],
    ];
    for (const [ua, family] of cases) expect(userAgentFamily(ua)).toBe(family);
    expect(userAgentFamily('')).toBeUndefined();
    expect(userAgentFamily(null)).toBeUndefined();
  });
});

describe('error mapping', () => {
  it('maps domain, zod, framework and unknown errors to the public shape', () => {
    expect(mapError(new DomainError('NOPE', 409, 'No.'))).toMatchObject({ status: 409, body: { error: { code: 'NOPE', message: 'No.' } } });
    const zerr = z.strictObject({ a: z.string() }).safeParse({ a: 1, b: 2 }).error!;
    expect(mapError(zerr)).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_FAILED' } } });
    expect(mapError(Object.assign(new Error('x'), { code: 'FST_ERR_CTP_BODY_TOO_LARGE', statusCode: 413 })).status).toBe(413);
    expect(mapError(Object.assign(new Error('x'), { statusCode: 429 })).body.error.code).toBe('RATE_LIMITED');
    const internal = mapError(new TypeError('cannot read x of undefined'));
    expect(internal).toMatchObject({ status: 500, body: { error: { code: 'INTERNAL_ERROR' } }, level: 'error' });
    expect(JSON.stringify(internal.body)).not.toContain('undefined');
  });

  it('describes zod failures by field without values', () => {
    const r = z.strictObject({ email: z.string().max(3) }).safeParse({ email: 'secret-value' });
    expect(zodMessage(r.error!)).toMatch(/^email: /);
    expect(zodMessage(r.error!)).not.toContain('secret-value');
    const u = z.strictObject({}).safeParse({ x: 1 });
    expect(zodMessage(u.error!)).toBe('The request contains unknown fields: x.');
  });
});

describe('schemas', () => {
  it('normalises product references', () => {
    expect(parse(productRef, ' o26-j-00184 ')).toBe('O26-J-00184');
    expect(parse(productRef, '3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    expect(() => parse(productRef, 'O26-J-184')).toThrow(DomainError);
    expect(() => parse(productRef, "'; DROP TABLE products; --")).toThrow(DomainError);
  });

  it('accepts optional bodies only when empty', () => {
    expect(parse(emptyBody, undefined)).toEqual({});
    expect(parse(emptyBody, {})).toEqual({});
    expect(() => parse(emptyBody, { x: 1 })).toThrow(/unknown fields/);
    expect(() => parse(body({ a: z.string() }), 'text')).toThrow(/JSON object/);
  });

  it('bounds the verify input', () => {
    expect(parse(verifyBody, { code: 'AbC-_9' })).toEqual({ code: 'AbC-_9' });
    // Undecodable strings reach the service, which answers MALFORMED_CODE (contract §2.4 step 1).
    expect(parse(verifyBody, { code: '' })).toEqual({ code: '' });
    expect(parse(verifyBody, { code: 'A'.repeat(201) })).toEqual({ code: 'A'.repeat(201) });
    expect(() => parse(verifyBody, { code: 'A'.repeat(1025) })).toThrow();
    expect(() => parse(verifyBody, { code: 42 })).toThrow();
    expect(() => parse(verifyBody, { code: 'AAAA', genome: { glyphs: Array(8).fill(null), confidence: [2, 0, 0, 0, 0, 0, 0, 0] } })).toThrow();
  });

  it('parses pagination leniently', () => {
    expect(pageOf({})).toEqual({ page: 1, pageSize: 50 });
    expect(pageOf({ page: '3', pageSize: '500' })).toEqual({ page: 3, pageSize: 200 });
    expect(pageOf(null)).toEqual({ page: 1, pageSize: 50 });
  });
});

describe('guards and helpers', () => {
  it('ranks roles ADMIN > OPERATOR > AUDITOR', () => {
    expect(hasRole('ADMIN', 'OPERATOR')).toBe(true);
    expect(hasRole('OPERATOR', 'OPERATOR')).toBe(true);
    expect(hasRole('AUDITOR', 'OPERATOR')).toBe(false);
    expect(hasRole('OPERATOR', 'ADMIN')).toBe(false);
  });

  it('checks Origin exactly', () => {
    const cfg = { publicOrigin: 'https://verify.theorbes.com' };
    expect(originAllowed(cfg, { headers: { origin: 'https://verify.theorbes.com' } })).toBe(true);
    expect(originAllowed(cfg, { headers: { origin: 'https://verify.theorbes.com.evil.io' } })).toBe(false);
    expect(originAllowed(cfg, { headers: { origin: 'http://verify.theorbes.com' } })).toBe(false);
    expect(originAllowed(cfg, { headers: {} })).toBe(false);
    expect(originAllowed(cfg, { headers: { 'sec-fetch-site': 'same-origin' } })).toBe(true);
    expect(originAllowed(cfg, { headers: { 'sec-fetch-site': 'same-site' } })).toBe(false);
  });

  it('sanitises download names and LIKE patterns', () => {
    expect(safeFilename('ORBES O26-J-00184 "x".svg')).toBe('ORBES_O26-J-00184__x_.svg');
    expect(safeFilename('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});

describe('logging', () => {
  it('buffers to the stream until attached, then forwards', () => {
    const out: string[] = [];
    const log = createForwardingLogger({ write: (s: string) => out.push(s) });
    log.info({ a: 1 }, 'early');
    expect(JSON.parse(out[0])).toMatchObject({ level: 'info', a: 1, msg: 'early' });
    const seen: unknown[] = [];
    log.attach({ info: (o) => seen.push(o), warn: () => {}, error: () => {} });
    log.info({ b: 2 }, 'late');
    expect(seen).toEqual([{ b: 2 }]);
    expect(out).toHaveLength(1);
  });

  it('logs requests without IPs or query strings', () => {
    const opts = loggerOptions({ logLevel: 'info' }) as { serializers: { req: (r: unknown) => unknown }; redact: { paths: string[] } };
    expect(opts.serializers.req({ method: 'POST', url: '/api/v1/verify?token=abc', id: 'r1', ip: '1.2.3.4' })).toEqual({ method: 'POST', url: '/api/v1/verify', reqId: 'r1' });
    expect(opts.redact.paths).toContain('req.headers.cookie');
  });
});
