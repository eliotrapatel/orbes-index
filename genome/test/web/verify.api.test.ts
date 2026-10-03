import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, CONTACT_TIMEOUT_MS, filenameOf, settledWithin, toApiError } from '../../src/web/verify/api.js';
import { SessionStore } from '../../src/web/verify/session.js';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  credentials?: RequestCredentials;
}

type Responder = (call: Call) => Response | Promise<Response>;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const SESSION = (token: string) => ({ account: { email: 'a@example.com', displayName: null }, csrfToken: token });

/** A fetch double that records calls and answers from a queue (or a function). */
function fakeFetch(responders: Responder[] | Responder) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      credentials: init?.credentials,
    };
    calls.push(call);
    const r = Array.isArray(responders) ? responders.shift() : responders;
    if (!r) throw new Error(`unexpected request ${call.method} ${call.url}`);
    return r(call);
  }) as typeof fetch;
  return { impl, calls };
}

describe('ApiClient', () => {
  it('posts verify requests as same-origin JSON without a CSRF header', async () => {
    const f = fakeFetch([() => json(200, { state: 'AUTHENTIC', scanId: 'x', verifiedAt: 'y', title: 'AUTHENTIC', message: 'm' })]);
    const api = new ApiClient({ fetch: f.impl });
    const out = await api.verify({ code: 'abc', client: { source: 'camera' } });
    expect(out.state).toBe('AUTHENTIC');
    expect(f.calls[0]).toMatchObject({
      url: '/api/v1/verify',
      method: 'POST',
      credentials: 'same-origin',
      body: { code: 'abc', client: { source: 'camera' } },
    });
    expect(f.calls[0].headers['content-type']).toBe('application/json');
    expect(f.calls[0].headers['x-csrf-token']).toBeUndefined();
  });

  it('reads the ORBES Client Services contact with a GET the browser may answer from its cache (public, 5 minutes)', async () => {
    const caches: (RequestCache | undefined)[] = [];
    const f = fakeFetch([() => json(200, { email: 'clientservices@theorbes.com' }), () => json(200, { state: 'AUTHENTIC' })]);
    const api = new ApiClient({
      fetch: (input, init) => {
        caches.push(init?.cache);
        return f.impl(input, init);
      },
    });
    expect(await api.clientServices()).toEqual({ email: 'clientservices@theorbes.com' });
    expect(f.calls[0]).toMatchObject({ url: '/api/v1/client-services', method: 'GET', credentials: 'same-origin', body: undefined });
    expect(f.calls[0].headers['x-csrf-token']).toBeUndefined();
    // Every other request stays out of the cache.
    await api.verify({ code: 'abc' });
    expect(caches).toEqual(['default', 'no-store']);
  });

  it('gives up the contact read after its own short timeout, never the verification\'s 15 s', async () => {
    vi.useFakeTimers();
    try {
      // A server that never answers the contact read (the fetch only ends when aborted).
      const stalled: typeof fetch = (_input, init) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      const api = new ApiClient({ fetch: stalled });
      const read = api.clientServices().then(
        () => 'answered',
        (e: unknown) => (e instanceof ApiError ? e.code : 'other'),
      );
      await vi.advanceTimersByTimeAsync(CONTACT_TIMEOUT_MS - 1);
      expect(await Promise.race([read, Promise.resolve('pending')])).toBe('pending');
      await vi.advanceTimersByTimeAsync(1);
      expect(await read).toBe('TIMEOUT');
      expect(CONTACT_TIMEOUT_MS).toBeLessThan(15_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('settledWithin: the value when it comes in time, else the fallback, and the read runs on', async () => {
    vi.useFakeTimers();
    try {
      expect(await settledWithin<{ email?: string }>(Promise.resolve({ email: 'a@b.co' }), 1_000, {})).toEqual({ email: 'a@b.co' });
      let answer!: (v: { email: string }) => void;
      const slow = new Promise<{ email: string } | Record<string, never>>((resolve) => (answer = resolve));
      const result = settledWithin(slow, 1_000, {});
      await vi.advanceTimersByTimeAsync(999);
      expect(await Promise.race([result, Promise.resolve('pending')])).toBe('pending');
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toEqual({});
      // The late answer still arrives for whoever kept the read (the app's cache).
      answer({ email: 'late@theorbes.com' });
      expect(await slow).toEqual({ email: 'late@theorbes.com' });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('learns the CSRF token from /me and sends it on account mutations', async () => {
    const f = fakeFetch([() => json(200, SESSION('t1')), () => json(201, { productId: 'O26-J-00184', verified: true, since: '2026-10-01' })]);
    const api = new ApiClient({ fetch: f.impl });
    expect(await api.me()).toEqual(SESSION('t1'));
    expect(api.hasSession).toBe(true);
    const r = await api.registerProduct('tok', ' AB12-CD34-EF56 ');
    expect(r.verified).toBe(true);
    expect(f.calls[1]).toMatchObject({ url: '/api/v1/ownership/register', method: 'POST', body: { registrationToken: 'tok', claimCode: 'AB12-CD34-EF56' } });
    expect(f.calls[1].headers['x-csrf-token']).toBe('t1');
  });

  it('sends a report on a scan as same-origin JSON, without a CSRF header, empty optional fields left out', async () => {
    const f = fakeFetch([() => json(201, { ok: true }), () => json(201, { ok: true }), () => json(409, { error: { code: 'REPORT_ALREADY_SENT', message: 'A report has already been sent for this reference.' } })]);
    const api = new ApiClient({ fetch: f.impl });
    const scanId = '4515b884-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
    await api.report({ scanId, channel: 'ONLINE', where: '  a marketplace  ', note: 'Listed at a third of the price.' });
    expect(f.calls[0]).toMatchObject({
      url: '/api/v1/reports',
      method: 'POST',
      credentials: 'same-origin',
      body: { scanId, channel: 'ONLINE', where: 'a marketplace', note: 'Listed at a third of the price.' },
    });
    expect(f.calls[0].headers['x-csrf-token']).toBeUndefined();
    await api.report({ scanId, channel: 'OTHER', where: '   ', note: '' });
    expect(f.calls[1].body).toEqual({ scanId, channel: 'OTHER' });
    // The server's refusal, as it is written for customers.
    await expect(api.report({ scanId, channel: 'OTHER' })).rejects.toMatchObject({ status: 409, code: 'REPORT_ALREADY_SENT', message: 'A report has already been sent for this reference.' });
  });

  it('changes the password with the CSRF token; a wrong current password (400) keeps the session', async () => {
    const f = fakeFetch([
      () => json(200, SESSION('t1')),
      () => json(400, { error: { code: 'CURRENT_PASSWORD_INVALID', message: 'The current password is not correct.' } }),
      () => json(200, { ok: true }),
    ]);
    const api = new ApiClient({ fetch: f.impl });
    await api.me();
    await expect(api.changePassword('wrong one', 'a brand new passphrase')).rejects.toMatchObject({ status: 400, code: 'CURRENT_PASSWORD_INVALID' });
    expect(api.hasSession).toBe(true);
    await api.changePassword('correct horse battery', 'a brand new passphrase');
    expect(f.calls[2]).toMatchObject({ url: '/api/v1/account/password', method: 'POST', body: { currentPassword: 'correct horse battery', newPassword: 'a brand new passphrase' } });
    expect(f.calls[2].headers['x-csrf-token']).toBe('t1');
  });

  it('recovers an account without a CSRF header (session-less), and forgets any session: every one has ended', async () => {
    const f = fakeFetch([
      () => json(200, SESSION('t1')),
      () => json(200, { ok: true, transfersPausedUntil: '2026-10-05T09:00:00.000Z' }),
      () => json(400, { error: { code: 'RECOVERY_CODE_INVALID', message: 'This email and recovery code do not match.' } }),
    ]);
    const api = new ApiClient({ fetch: f.impl });
    await api.me();
    const r = await api.recoverAccount('a@example.com', ' abcd-efgh-jkmn ', 'a brand new passphrase');
    expect(r.transfersPausedUntil).toBe('2026-10-05T09:00:00.000Z');
    expect(f.calls[1]).toMatchObject({
      url: '/api/v1/account/recover',
      method: 'POST',
      credentials: 'same-origin',
      body: { email: 'a@example.com', recoveryCode: 'abcd-efgh-jkmn', newPassword: 'a brand new passphrase' },
    });
    expect(f.calls[1].headers['x-csrf-token']).toBeUndefined();
    expect(api.hasSession).toBe(false);
    await expect(api.recoverAccount('a@example.com', 'ZZZZ-ZZZZ-ZZZZ', 'a brand new passphrase')).rejects.toMatchObject({ status: 400, code: 'RECOVERY_CODE_INVALID' });
  });

  it('MY PIECES (F-01): lists the pieces and a service history (GET), reports and withdraws an incident with the CSRF token', async () => {
    const piece = { productId: 'O26-J-00184', incident: null, incidentResolvable: false };
    const f = fakeFetch([
      () => json(200, SESSION('t1')),
      () => json(200, { products: [piece] }),
      () => json(200, { productId: 'O26-J-00184', services: [{ id: 's1', type: 'POLISH', status: 'COMPLETED', location: null, openedAt: 'a', closedAt: 'b' }] }),
      () => json(201, { productId: 'O26-J-00184', type: 'LOST', reportedAt: '2026-10-03T09:00:00.000Z' }),
      () => json(200, { productId: 'O26-J-00184', type: 'LOST', resolvedAt: '2026-10-03T10:00:00.000Z' }),
      () => json(409, { error: { code: 'INCIDENT_NOT_RESOLVABLE', message: 'Only a loss you reported yourself can be withdrawn here. ORBES Client Services can assist you.' } }),
      () => json(200, { unexpected: true }),
    ]);
    const api = new ApiClient({ fetch: f.impl });
    await api.me();
    expect(await api.products()).toEqual([piece]);
    expect(f.calls[1]).toMatchObject({ url: '/api/v1/account/products', method: 'GET', credentials: 'same-origin', body: undefined });
    expect((await api.serviceHistory('O26-J-00184')).map((s) => s.type)).toEqual(['POLISH']);
    expect(f.calls[2]).toMatchObject({ url: '/api/v1/products/O26-J-00184/service-history', method: 'GET' });
    expect(await api.reportIncident('O26-J-00184', 'LOST')).toMatchObject({ type: 'LOST' });
    expect(f.calls[3]).toMatchObject({ url: '/api/v1/ownership/incidents', method: 'POST', body: { productId: 'O26-J-00184', type: 'LOST' } });
    expect(f.calls[3].headers['x-csrf-token']).toBe('t1');
    expect(await api.resolveIncident('O26-J-00184')).toMatchObject({ resolvedAt: '2026-10-03T10:00:00.000Z' });
    expect(f.calls[4]).toMatchObject({ url: '/api/v1/ownership/incidents/resolve', method: 'POST', body: { productId: 'O26-J-00184' } });
    expect(f.calls[4].headers['x-csrf-token']).toBe('t1');
    // A theft: the server's sentence, as it is written for the owner.
    await expect(api.resolveIncident('O26-J-00184')).rejects.toMatchObject({ status: 409, code: 'INCIDENT_NOT_RESOLVABLE' });
    // A list that is not one is a bad response, never an empty list.
    await expect(api.products()).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('RECEIVE THIS PIECE (F-03): sends the code with the piece scanned and the transfer token of that scan, with the CSRF token', async () => {
    const f = fakeFetch([
      () => json(200, SESSION('t1')),
      () => json(409, { error: { code: 'TRANSFER_PRODUCT_MISMATCH', message: 'This transfer code is not for this piece. Check the code with the owner of this piece.' } }),
      () => json(200, { productId: 'O26-J-00184', verified: true, since: '2026-10-03T09:00:00.000Z' }),
    ]);
    const api = new ApiClient({ fetch: f.impl });
    await api.me();
    const token = 'T'.repeat(43);
    await expect(api.acceptTransfer(' AAAA-BBBB-CCCC ', 'O26-J-00184', token)).rejects.toMatchObject({ status: 409, code: 'TRANSFER_PRODUCT_MISMATCH' });
    expect(f.calls[1]).toMatchObject({
      url: '/api/v1/ownership/transfers/accept',
      method: 'POST',
      body: { transferCode: 'AAAA-BBBB-CCCC', productId: 'O26-J-00184', transferToken: token },
    });
    expect(f.calls[1].headers['x-csrf-token']).toBe('t1');
    // A refusal is no sign-out.
    expect(api.hasSession).toBe(true);
    expect(await api.acceptTransfer('2KRJ-RW75-58PH', 'O26-J-00184', token)).toMatchObject({ productId: 'O26-J-00184', verified: true });
  });

  it('ownership certificates (F-06): creates, lists and withdraws with the CSRF token; reads one and its PDF with none, the token in the body', async () => {
    const offer = { id: '5a864af8-0d6b-4c1e-9f2a-3b7c1d2e4f5a', productId: 'O26-J-00184', token: 'T'.repeat(52), url: `https://verify.theorbes.com/verify/c#${'T'.repeat(52)}`, createdAt: 'a', expiresAt: 'b' };
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const f = fakeFetch([
      () => json(200, SESSION('t1')),
      () => json(201, offer),
      () => json(200, { certificates: [{ id: offer.id, productId: offer.productId, createdAt: 'a', expiresAt: 'b', valid: true }] }),
      () => json(200, { ok: true }),
      () => json(200, { status: 'NO_LONGER_VALID', checkedAt: 'c' }),
      () => new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="ORBES-ownership-certificate-O26-J-00184-2026-10-03.pdf"' } }),
      () => json(409, { error: { code: 'CERTIFICATE_NO_LONGER_VALID', message: 'This certificate is no longer valid. Ask the owner of the piece for a new one.' } }),
      () => json(404, { error: { code: 'CERTIFICATE_NOT_FOUND', message: 'This certificate link is not valid.' } }),
      () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      () => json(200, { unexpected: true }),
    ]);
    const api = new ApiClient({ fetch: f.impl });
    await api.me();
    expect(await api.createCertificate('O26-J-00184', 30)).toEqual(offer);
    expect(f.calls[1]).toMatchObject({ url: '/api/v1/ownership/certificates', method: 'POST', body: { productId: 'O26-J-00184', validDays: 30 } });
    expect(f.calls[1].headers['x-csrf-token']).toBe('t1');
    expect((await api.certificates()).map((c) => c.id)).toEqual([offer.id]);
    expect(f.calls[2]).toMatchObject({ url: '/api/v1/ownership/certificates', method: 'GET', body: undefined });
    await api.revokeCertificate(offer.id);
    expect(f.calls[3]).toMatchObject({ url: `/api/v1/ownership/certificates/${offer.id}`, method: 'DELETE', body: undefined });
    expect(f.calls[3].headers['x-csrf-token']).toBe('t1');
    expect(f.calls[3].headers['content-type']).toBeUndefined();
    // The public reads: the token in the body (never in the address), no CSRF header.
    expect(await api.lookupCertificate(offer.token)).toEqual({ status: 'NO_LONGER_VALID', checkedAt: 'c' });
    expect(f.calls[4]).toMatchObject({ url: '/api/v1/certificates/lookup', method: 'POST', body: { token: offer.token } });
    expect(f.calls[4].headers['x-csrf-token']).toBeUndefined();
    const file = await api.certificatePdf(offer.token);
    expect(file.filename).toBe('ORBES-ownership-certificate-O26-J-00184-2026-10-03.pdf');
    expect(new Uint8Array(await file.blob.arrayBuffer())).toEqual(pdf);
    expect(f.calls[5]).toMatchObject({ url: '/api/v1/certificates/pdf', method: 'POST', body: { token: offer.token } });
    expect(f.calls[5].headers['x-csrf-token']).toBeUndefined();
    // The server's refusals as it wrote them; a body that is not a PDF is a bad response.
    await expect(api.certificatePdf(offer.token)).rejects.toMatchObject({ status: 409, code: 'CERTIFICATE_NO_LONGER_VALID' });
    await expect(api.lookupCertificate(offer.token)).rejects.toMatchObject({ status: 404, code: 'CERTIFICATE_NOT_FOUND' });
    await expect(api.certificatePdf(offer.token)).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    await expect(api.certificates()).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    expect(api.hasSession).toBe(true);
  });

  it('filenameOf: the attachment\'s name when it is a plain one, else the fallback', () => {
    expect(filenameOf('attachment; filename="ORBES-ownership-certificate-O26-J-00184-2026-10-03.pdf"', 'x.pdf')).toBe('ORBES-ownership-certificate-O26-J-00184-2026-10-03.pdf');
    expect(filenameOf('attachment; filename="../../etc/passwd"', 'x.pdf')).toBe('x.pdf');
    expect(filenameOf(null, 'x.pdf')).toBe('x.pdf');
  });

  it('puts a product id in the service-history path encoded', async () => {
    const f = fakeFetch([() => json(200, { productId: 'x', services: [] })]);
    await new ApiClient({ fetch: f.impl }).serviceHistory('a/../b?c');
    expect(f.calls[0].url).toBe('/api/v1/products/a%2F..%2Fb%3Fc/service-history');
  });

  it('omits an empty claim code and display name', async () => {
    const f = fakeFetch([() => json(201, SESSION('t')), () => json(201, { productId: 'p', verified: false, since: 's' })]);
    const api = new ApiClient({ fetch: f.impl });
    await api.register('a@example.com', 'correct horse battery', '   ');
    await api.registerProduct('tok', '');
    expect(f.calls[0].body).toEqual({ email: 'a@example.com', password: 'correct horse battery' });
    expect(f.calls[1].body).toEqual({ registrationToken: 'tok' });
  });

  it('probes the session without a 401 when signed out (200 { account: null })', async () => {
    const f = fakeFetch([() => json(200, { account: null })]);
    const api = new ApiClient({ fetch: f.impl });
    expect(await api.me()).toBeNull();
    expect(api.hasSession).toBe(false);
    expect(f.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /api/v1/account/session']);
  });

  it('treats a 401 from the session probe as signed out', async () => {
    const f = fakeFetch([() => json(401, { error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } })]);
    const api = new ApiClient({ fetch: f.impl });
    expect(await api.me()).toBeNull();
    expect(api.hasSession).toBe(false);
  });

  it('refreshes a rotated CSRF token once and retries', async () => {
    const f = fakeFetch([
      () => json(200, SESSION('old')),
      () => json(403, { error: { code: 'CSRF_FAILED', message: 'The request could not be verified.' } }),
      () => json(200, SESSION('new')),
      () => json(201, { transferCode: 'AAAA-BBBB-CCCC', expiresAt: '2026-10-08T00:00:00.000Z' }),
    ]);
    const api = new ApiClient({ fetch: f.impl });
    await api.me();
    const offer = await api.initiateTransfer('O26-J-00184');
    expect(offer.transferCode).toBe('AAAA-BBBB-CCCC');
    expect(f.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/v1/account/session',
      'POST /api/v1/ownership/transfers',
      'GET /api/v1/account/session',
      'POST /api/v1/ownership/transfers',
    ]);
    expect(f.calls[1].headers['x-csrf-token']).toBe('old');
    expect(f.calls[3].headers['x-csrf-token']).toBe('new');
  });

  it('does not loop on a persistent CSRF failure', async () => {
    const csrf = () => json(403, { error: { code: 'CSRF_FAILED', message: 'The request could not be verified.' } });
    const f = fakeFetch([() => json(200, SESSION('a')), csrf, () => json(200, SESSION('b')), csrf]);
    const api = new ApiClient({ fetch: f.impl });
    await api.me();
    await expect(api.cancelTransfer('O26-J-00184')).rejects.toMatchObject({ status: 403, code: 'CSRF_FAILED' });
    expect(f.calls).toHaveLength(4);
  });

  it('surfaces the server error code and message, and forgets the session on 401', async () => {
    const f = fakeFetch([
      () => json(200, SESSION('t')),
      () => json(401, { error: { code: 'UNAUTHORIZED', message: 'Your session has ended.' } }),
    ]);
    const api = new ApiClient({ fetch: f.impl });
    await api.me();
    const e = await api.acceptTransfer('AAAA-BBBB-CCCC', 'O26-J-00184', 'T'.repeat(43)).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 401, code: 'UNAUTHORIZED', message: 'Your session has ended.' });
    expect(api.hasSession).toBe(false);
  });

  it('maps transport failures', async () => {
    const offline = new ApiClient({ fetch: fakeFetch(() => Promise.reject(new TypeError('Failed to fetch'))).impl });
    await expect(offline.verify({ code: 'x' })).rejects.toMatchObject({ status: 0, code: 'NETWORK', isNetwork: true });

    const hanging = new ApiClient({
      timeoutMs: 20,
      fetch: ((_: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        })) as typeof fetch,
    });
    await expect(hanging.verify({ code: 'x' })).rejects.toMatchObject({ status: 0, code: 'TIMEOUT' });

    const garbage = new ApiClient({ fetch: fakeFetch(() => new Response('<html>', { status: 200 })).impl });
    await expect(garbage.verify({ code: 'x' })).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('logout clears the token even when the request fails', async () => {
    const f = fakeFetch([() => json(200, SESSION('t')), () => Promise.reject(new TypeError('offline'))]);
    const api = new ApiClient({ fetch: f.impl });
    await api.me();
    await expect(api.logout()).rejects.toMatchObject({ code: 'NETWORK' });
    expect(api.hasSession).toBe(false);
    expect(f.calls[1].headers['x-csrf-token']).toBe('t');
  });
});

describe('toApiError', () => {
  it('tolerates bodies that are not the contract shape', () => {
    expect(toApiError(429, undefined)).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(toApiError(502, 'Bad gateway')).toMatchObject({ status: 502, code: 'HTTP_502', message: 'The request could not be completed.' });
    expect(toApiError(400, { error: { code: '<b>x</b>', message: 'm'.repeat(600) } })).toMatchObject({ code: 'HTTP_400', message: 'The request could not be completed.' });
    expect(toApiError(409, { error: { code: 'TRANSFER_PENDING', message: 'A transfer is already pending.' } })).toMatchObject({
      code: 'TRANSFER_PENDING',
      message: 'A transfer is already pending.',
    });
  });
});

describe('SessionStore', () => {
  it('asks the server once and notifies subscribers', async () => {
    const f = fakeFetch([() => json(200, SESSION('t'))]);
    const api = new ApiClient({ fetch: f.impl });
    const store = new SessionStore(api);
    const seen: string[] = [];
    store.subscribe((s) => seen.push(s.status));
    const [a, b] = await Promise.all([store.ensure(), store.ensure()]);
    expect(a).toEqual({ status: 'signed-in', account: { email: 'a@example.com', displayName: null } });
    expect(b).toBe(a);
    expect(f.calls).toHaveLength(1);
    expect(seen).toEqual(['signed-in']);
  });

  it('falls back to signed out on 401 and after an expired session', async () => {
    const f = fakeFetch([() => json(200, SESSION('t'))]);
    const api = new ApiClient({ fetch: f.impl });
    const store = new SessionStore(api);
    await store.ensure();
    store.noteError(new ApiError(403, 'FORBIDDEN', 'x'));
    expect(store.state.status).toBe('signed-in');
    store.noteError(new ApiError(401, 'UNAUTHORIZED', 'x'));
    expect(store.state.status).toBe('anonymous');
    expect(api.hasSession).toBe(false);
  });

  it('stays unknown when the server cannot be reached, so a later attempt can retry', async () => {
    const f = fakeFetch([() => Promise.reject(new TypeError('offline')), () => json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } })]);
    const store = new SessionStore(new ApiClient({ fetch: f.impl }));
    await expect(store.ensure()).rejects.toMatchObject({ code: 'NETWORK' });
    expect(store.state.status).toBe('unknown');
    expect((await store.ensure()).status).toBe('anonymous');
  });
});
