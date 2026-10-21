/**
 * POST and OPTIONS /api/v1/founding (plan MACRO M1 §3.1, §3.5 « test/api/founding.test.ts »; routes/founding.ts):
 * theorbes.com's form over HTTP.
 *
 *  - CORS for https://theorbes.com only: the preflight's headers; `Access-Control-Allow-Origin` and `Vary: Origin` on
 *    every answer, a refusal and a 429 included, so the form reads them; no credentials, no cookie;
 *  - another Origin, or none, refused 403 FOUNDING_ORIGIN by the server itself, before anything is read;
 *  - 202 `{ ok: true }` alike for a new address, one already on the list and the honeypot (no enumeration);
 *  - 400 with `fields` in the collector's words; JSON only; 2 KB at most (413);
 *  - the rate group `founding`: the api budget ÷ 12 per network (429 RATE_LIMITED).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FOUNDING_ORIGIN } from '../../src/server/services/founding.js';
import { FOUNDING_BODY_LIMIT, FOUNDING_PREFLIGHT_MAX_AGE } from '../../src/server/routes/founding.js';
import { createHarness, errorOf, safeJson, type Harness } from './support.js';

const ROUTE = '/api/v1/founding';
const person = (email: string, extra: Record<string, unknown> = {}) => ({ email, firstName: 'Léa', country: 'FR', consent: true, ...extra });

describe('POST and OPTIONS /api/v1/founding (plan MACRO M1 §3.1, F2 and F3)', () => {
  let h: Harness;
  let ip = 0;
  /** Each call from its own network unless told otherwise, so the narrow budget is spent only where a case means it. */
  const send = (body: unknown, opts: { origin?: string | null; ip?: string; headers?: Record<string, string>; raw?: string } = {}) =>
    h.app.inject({
      method: 'POST',
      url: ROUTE,
      remoteAddress: opts.ip ?? `198.51.100.${++ip}`,
      headers: { 'content-type': 'application/json', ...(opts.origin === null ? {} : { origin: opts.origin ?? FOUNDING_ORIGIN }), ...opts.headers },
      payload: opts.raw ?? JSON.stringify(body),
    });
  const rows = () => h.ctx.db.selectFrom('preregistrations').selectAll().execute();
  const cors = (res: { headers: Record<string, unknown> }) => [res.headers['access-control-allow-origin'], res.headers.vary];

  beforeAll(async () => {
    h = await createHarness({ config: { rateLimits: { apiPerMinute: 120 } } });
    h.clock.set('2026-10-21T08:00:00.000Z');
  });
  afterAll(() => h?.close());

  it('answers the preflight from theorbes.com: POST and content-type, 10 minutes, no credentials', async () => {
    const res = await h.app.inject({ method: 'OPTIONS', url: ROUTE, remoteAddress: '203.0.113.1', headers: { origin: FOUNDING_ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(res.headers['access-control-allow-origin']).toBe('https://theorbes.com');
    expect(res.headers['access-control-allow-methods']).toBe('POST');
    expect(res.headers['access-control-allow-headers']).toBe('content-type');
    expect(res.headers['access-control-max-age']).toBe(String(FOUNDING_PREFLIGHT_MAX_AGE));
    expect(FOUNDING_PREFLIGHT_MAX_AGE).toBe(600);
    expect(res.headers.vary).toBe('Origin');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
    // Another site's preflight: 403, no CORS grant.
    for (const origin of ['https://evil.example', 'https://www.theorbes.com', 'http://theorbes.com', 'https://verify.orbes.test', 'null']) {
      const other = await h.app.inject({ method: 'OPTIONS', url: ROUTE, remoteAddress: '203.0.113.1', headers: { origin, 'access-control-request-method': 'POST' } });
      expect([origin, other.statusCode, errorOf(other).code], origin).toEqual([origin, 403, 'FOUNDING_ORIGIN']);
      expect(other.headers['access-control-allow-origin'], origin).toBeUndefined();
    }
  });

  it('adds a person: 202 { ok: true } with the CORS grant, no cookie; the same answer for an address on the list and for the honeypot', async () => {
    const res = await send(person('first@example.com', { o: 'nope-code', utm: { source: 'ig' }, referrer: 'https://l.instagram.com/' }));
    expect(res.statusCode, res.body).toBe(202);
    expect(safeJson(res)).toEqual({ ok: true });
    expect(cors(res)).toEqual(['https://theorbes.com', 'Origin']);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect((await rows()).map((r) => r.email)).toEqual(['first@example.com']);
    // Again, in capitals, with other fields: the same answer, nothing changed.
    const again = await send(person('FIRST@example.com', { firstName: 'Other', country: 'IT' }));
    expect([again.statusCode, again.body]).toEqual([res.statusCode, res.body]);
    // The honeypot: the same answer, nothing stored.
    const bot = await send(person('bot@example.com', { website: 'https://spam.example' }));
    expect([bot.statusCode, bot.body]).toEqual([202, '{"ok":true}']);
    expect((await rows()).map((r) => [r.email, r.first_name, r.country])).toEqual([['first@example.com', 'Léa', 'FR']]);
  });

  it('refuses the fields in the collector’s words (400, `fields`), readable by the form', async () => {
    const res = await send({ email: 'nope', firstName: '', consent: false });
    expect(res.statusCode).toBe(400);
    expect(safeJson(res)).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Enter your email.',
        fields: { email: 'Enter your email.', firstName: 'Enter your first name.', country: 'Choose your country.', consent: 'Tick the box to join the list.' },
      },
    });
    expect(cors(res)).toEqual(['https://theorbes.com', 'Origin']);
    // An unknown key, a wrong type: the house's refusal of the body.
    expect(errorOf(await send({ ...person('x@example.com'), extra: 1 })).code).toBe('VALIDATION_FAILED');
    expect((await send({ ...person('x@example.com'), consent: 'yes' })).statusCode).toBe(400);
    // Junk arrival signals are dropped, never refused.
    expect((await send(person('junk@example.com', { o: '<script>', utm: { source: '\u0000' }, referrer: 'javascript:alert(1)' }))).statusCode).toBe(202);
  });

  it('refuses another Origin, or none, 403 FOUNDING_ORIGIN by the server itself, and stores nothing', async () => {
    const before = (await rows()).length;
    for (const origin of ['https://evil.example', 'https://theorbes.com.evil.example', 'https://verify.orbes.test', null]) {
      const res = await send(person('foreign@example.com'), { origin });
      expect([String(origin), res.statusCode, errorOf(res).code]).toEqual([String(origin), 403, 'FOUNDING_ORIGIN']);
      expect(errorOf(res).message).toBe('This form is only available on theorbes.com.');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers.vary).toBe('Origin');
    }
    expect(await rows()).toHaveLength(before);
  });

  it('speaks JSON only, and refuses a body over 2 KB with 413 the form can read', async () => {
    const plain = await send(undefined, { raw: 'email=x', headers: { 'content-type': 'text/plain' } });
    expect(plain.statusCode).toBe(415);
    expect(FOUNDING_BODY_LIMIT).toBe(2048);
    const big = await send(person('big@example.com', { website: '' }), { raw: JSON.stringify({ ...person('big@example.com'), referrer: `https://example.com/${'x'.repeat(2_100)}` }) });
    expect([big.statusCode, errorOf(big).code]).toEqual([413, 'PAYLOAD_TOO_LARGE']);
    expect(cors(big)).toEqual(['https://theorbes.com', 'Origin']);
  });

  it('draws on its own narrow budget, about 10 a minute per network (429, still readable by the form); the preflight on api', async () => {
    const net = '192.0.2.77';
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await send(person(`rate-${i}@example.com`), { ip: net })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 202)).toBe(true);
    const limited = await send(person('rate-x@example.com'), { ip: net });
    expect([limited.statusCode, errorOf(limited).code]).toEqual([429, 'RATE_LIMITED']);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(cors(limited)).toEqual(['https://theorbes.com', 'Origin']);
    // Another network is not affected; the preflight still answers from the limited one.
    expect((await send(person('rate-y@example.com'))).statusCode).toBe(202);
    const pre = await h.app.inject({ method: 'OPTIONS', url: ROUTE, remoteAddress: net, headers: { origin: FOUNDING_ORIGIN } });
    expect(pre.statusCode).toBe(204);
  });
});
