import { describe, expect, it } from 'vitest';
import { ApiClient, ApiError, toApiError } from '../../src/web/verify/api.js';
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
    const e = await api.acceptTransfer('AAAA-BBBB-CCCC').catch((x: unknown) => x);
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
