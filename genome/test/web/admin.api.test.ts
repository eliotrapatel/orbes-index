import { describe, expect, it, vi } from 'vitest';
import { AdminApi, ApiError, type FetchLike } from '../../src/web/admin/api.js';

interface Call {
  url: string;
  init: RequestInit;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** A fake fetch answering from a queue of responses, recording every call. */
function fakeFetch(...responses: (Response | Error)[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init = {}) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (!r) throw new Error('unexpected request');
    if (r instanceof Error) throw r;
    return r;
  };
  return { fetch, calls };
}

const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

const SESSION = { admin: { id: 'a', email: 'admin@orbes.test', role: 'ADMIN', totpEnabled: false, passwordChangeRequired: false }, csrfToken: 'tok-1', mfaPassed: true, mfaRequired: false };

describe('AdminApi', () => {
  it('stores the CSRF token from login and sends it on mutations only', async () => {
    const { fetch, calls } = fakeFetch(json(200, SESSION), json(200, { items: [] }), json(201, { keyId: 2 }));
    const api = new AdminApi({ fetch });
    await api.login('admin@orbes.test', 'pw');
    await api.keys();
    await api.rotateKey();
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: 'admin@orbes.test', password: 'pw' });
    expect(header(calls[1], 'x-csrf-token')).toBeUndefined();
    expect(calls[1].init.method).toBe('GET');
    expect(header(calls[2], 'x-csrf-token')).toBe('tok-1');
    expect(header(calls[2], 'content-type')).toBe('application/json');
    expect(calls[2].init.credentials).toBe('same-origin');
    expect(calls[2].url).toBe('/api/admin/keys/rotate');
  });

  it('sends the TOTP only when given', async () => {
    const { fetch, calls } = fakeFetch(json(200, SESSION));
    await new AdminApi({ fetch }).login('a@b.c', 'pw', '123456');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: 'a@b.c', password: 'pw', totp: '123456' });
  });

  it('maps error bodies to ApiError with the public message', async () => {
    const { fetch } = fakeFetch(json(401, { error: { code: 'TOTP_REQUIRED', message: 'Enter the code from your authenticator app.' } }));
    const err = await new AdminApi({ fetch }).login('a@b.c', 'pw').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: 'TOTP_REQUIRED', message: 'Enter the code from your authenticator app.' });
  });

  it('uses a generic message for non-JSON errors and network failures', async () => {
    const { fetch } = fakeFetch(new Response('<html>Bad gateway</html>', { status: 502 }), new TypeError('fetch failed'));
    const api = new AdminApi({ fetch });
    await expect(api.dashboard()).rejects.toMatchObject({ status: 502, code: 'HTTP_502', message: 'The server could not complete the request.' });
    await expect(api.dashboard()).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
  });

  it('reports an expired session once and clears the token', async () => {
    const onUnauthorized = vi.fn();
    const { fetch } = fakeFetch(json(200, SESSION), json(401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }));
    const api = new AdminApi({ fetch, onUnauthorized });
    await api.me();
    expect(api.csrfToken).toBe('tok-1');
    await expect(api.dashboard()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(api.csrfToken).toBeNull();
  });

  it('does not treat a failed login or /me as an expired session', async () => {
    const onUnauthorized = vi.fn();
    const { fetch } = fakeFetch(json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } }), json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }));
    const api = new AdminApi({ fetch, onUnauthorized });
    await expect(api.login('a@b.c', 'bad')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('refreshes the CSRF token once and retries on CSRF_FAILED', async () => {
    const { fetch, calls } = fakeFetch(
      json(200, SESSION),
      json(403, { error: { code: 'CSRF_FAILED', message: 'Invalid CSRF token.' } }),
      json(200, { ...SESSION, csrfToken: 'tok-2' }),
      json(200, { ok: true }),
    );
    const api = new AdminApi({ fetch });
    await api.me();
    await api.confirmOwnership('O26-J-00184');
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'GET /api/admin/auth/me',
      'POST /api/admin/products/O26-J-00184/ownership/confirm',
      'GET /api/admin/auth/me',
      'POST /api/admin/products/O26-J-00184/ownership/confirm',
    ]);
    expect(header(calls[3], 'x-csrf-token')).toBe('tok-2');
  });

  it('does not retry a second CSRF failure', async () => {
    const csrf = () => json(403, { error: { code: 'CSRF_FAILED', message: 'Invalid CSRF token.' } });
    const { fetch, calls } = fakeFetch(csrf(), json(200, SESSION), csrf());
    await expect(new AdminApi({ fetch }).rotateKey()).rejects.toMatchObject({ code: 'CSRF_FAILED' });
    expect(calls).toHaveLength(3);
  });

  it('encodes path segments and builds list queries', async () => {
    const { fetch, calls } = fakeFetch(json(200, { items: [], page: 1, pageSize: 50, total: 0 }), json(200, {}), json(200, {}));
    const api = new AdminApi({ fetch });
    await api.products({ status: 'OWNED', q: 'a b', category: '', page: 2 });
    await api.product('../keys');
    await api.updateAnomaly('11111111-1111-4111-8111-111111111111', 'RESOLVED', 'checked');
    expect(calls[0].url).toBe('/api/admin/products?status=OWNED&q=a%20b&page=2');
    expect(calls[1].url).toBe('/api/admin/products/..%2Fkeys');
    expect(calls[2].init.method).toBe('PATCH');
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ status: 'RESOLVED', note: 'checked' });
  });

  it('downloads artifacts as blobs with a safe file name, dpi only for PNG', async () => {
    const { fetch, calls } = fakeFetch(
      new Response('<svg/>', { status: 200, headers: { 'content-type': 'image/svg+xml', 'content-disposition': 'attachment; filename="ORBES-O26-J-00001-I1-classic-30mm.svg"' } }),
      new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } }),
    );
    const api = new AdminApi({ fetch });
    const svg = await api.artifact('c0de', 'svg', { widthMm: 30, theme: 'classic', label: true, dpi: 600 });
    expect(calls[0].url).toBe('/api/admin/codes/c0de/artifact.svg?widthMm=30&theme=classic&label=true');
    expect(svg.filename).toBe('ORBES-O26-J-00001-I1-classic-30mm.svg');
    expect(await svg.blob.text()).toBe('<svg/>');
    const png = await api.artifact('c0de', 'png', { dpi: 1200 });
    expect(calls[1].url).toBe('/api/admin/codes/c0de/artifact.png?dpi=1200');
    expect(png.filename).toBe('orbes-code.png');
    expect(png.contentType).toBe('image/png');
  });

  it('keeps the new CSRF token of the session that TOTP enrolment rotates in', async () => {
    const { fetch, calls } = fakeFetch(json(200, SESSION), json(200, { ok: true, mfaPassed: true, csrfToken: 'tok-2' }), json(200, { items: [] }), json(200, { admin: { id: 'b' } }));
    const api = new AdminApi({ fetch });
    await api.login('admin@orbes.test', 'pw');
    await api.totpEnable('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', '123456');
    expect(api.csrfToken).toBe('tok-2');
    await api.admins();
    await api.resetAdminTotp('b/1');
    expect(calls[2].url).toBe('/api/admin/admins');
    expect(calls[3].url).toBe('/api/admin/admins/b%2F1/totp/reset');
    expect(header(calls[3], 'x-csrf-token')).toBe('tok-2');
  });

  it('manages console users on the Team routes (A-02): methods, paths, bodies and the CSRF token', async () => {
    const { fetch, calls } = fakeFetch(
      json(200, SESSION),
      json(201, { admin: { id: 'n' }, temporaryPassword: 'ABCD-EFGH-JKMN-PQRS' }),
      json(200, { admin: { id: 'n' } }),
      json(200, { admin: { id: 'n' }, sessionsRevoked: 1 }),
      json(200, { admin: { id: 'n' }, sessionsRevoked: 0 }),
      json(200, { admin: { id: 'n' } }),
      json(200, { items: [] }),
      json(200, { sessionsRevoked: 2 }),
      json(200, { ok: true, admin: { id: 'a' } }),
    );
    const api = new AdminApi({ fetch });
    await api.login('admin@orbes.test', 'pw');
    expect((await api.createStaff('new@orbes.test', 'AUDITOR')).temporaryPassword).toBe('ABCD-EFGH-JKMN-PQRS');
    await api.setAdminRole('n/1', 'OPERATOR');
    await api.disableAdmin('n');
    await api.enableAdmin('n');
    await api.unlockAdmin('n');
    await api.adminSessions('n');
    expect(await api.revokeAdminSessions('n')).toEqual({ sessionsRevoked: 2 });
    await api.changePassword('old passphrase', 'new passphrase 2026');
    expect(calls.slice(1).map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'POST /api/admin/admins',
      'PATCH /api/admin/admins/n%2F1/role',
      'POST /api/admin/admins/n/disable',
      'POST /api/admin/admins/n/enable',
      'POST /api/admin/admins/n/unlock',
      'GET /api/admin/admins/n/sessions',
      'DELETE /api/admin/admins/n/sessions',
      'POST /api/admin/auth/password',
    ]);
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ email: 'new@orbes.test', role: 'AUDITOR' });
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ role: 'OPERATOR' });
    expect(calls[7].init.body).toBeUndefined(); // DELETE: no body
    expect(JSON.parse(String(calls[8].init.body))).toEqual({ currentPassword: 'old passphrase', newPassword: 'new passphrase 2026' });
    for (const c of calls.slice(1)) expect(header(c, 'x-csrf-token'), c.url).toBe(c.init.method === 'GET' ? undefined : 'tok-1');
  });

  it('a wrong current password is a refusal, not an expired session', async () => {
    const onUnauthorized = vi.fn();
    const { fetch } = fakeFetch(json(200, SESSION), json(400, { error: { code: 'CURRENT_PASSWORD_INVALID', message: 'The current password is not correct.' } }));
    const api = new AdminApi({ fetch, onUnauthorized });
    await api.me();
    await expect(api.changePassword('wrong', 'new passphrase 2026')).rejects.toMatchObject({ status: 400, code: 'CURRENT_PASSWORD_INVALID' });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(api.csrfToken).toBe('tok-1');
  });

  it('extends a warranty and downloads a print sheet of several codes (POST, CSRF, blob)', async () => {
    const pdf = new Response(new Uint8Array([37, 80, 68, 70]), {
      status: 200,
      headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="ORBES-sheet-2026-10-01-2-classic-25mm.pdf"' },
    });
    const { fetch, calls } = fakeFetch(json(200, SESSION), json(200, { warranty: { durationMonths: 36 } }), pdf);
    const api = new AdminApi({ fetch });
    await api.login('admin@orbes.test', 'pw');
    await api.extendWarranty('O26-J-00184', 12);
    expect(calls[1].url).toBe('/api/admin/products/O26-J-00184/warranty/extend');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ months: 12 });
    const sheet = await api.printSheet(['c1', 'c2'], { widthMm: 25, theme: 'classic', label: true, page: 'A4' });
    expect(calls[2].url).toBe('/api/admin/codes/print-sheet');
    expect(calls[2].init.method).toBe('POST');
    expect(header(calls[2], 'x-csrf-token')).toBe('tok-1');
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ codeIds: ['c1', 'c2'], widthMm: 25, theme: 'classic', label: true, page: 'A4' });
    expect(sheet).toMatchObject({ filename: 'ORBES-sheet-2026-10-01-2-classic-25mm.pdf', contentType: 'application/pdf' });
    expect(sheet.blob.size).toBe(4);
  });

  it('downloads certificate cards: claim codes in a POST body, never in the URL', async () => {
    const pdf = new Response(new Uint8Array([37, 80, 68, 70]), {
      status: 200,
      headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="ORBES-certificate-O26-J-00184-PROOF.pdf"' },
    });
    const csv = new Response('"productId"\r\n', { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8; header=present' } });
    const { fetch, calls } = fakeFetch(json(200, SESSION), pdf, csv);
    const api = new AdminApi({ fetch });
    await api.login('admin@orbes.test', 'pw');
    const card = await api.certificates([{ productId: 'O26-J-00184', claimCode: '7KQ2-M4TD-9XWH' }], { format: 'pdf', layout: 'card' });
    expect(calls[1].url).toBe('/api/admin/certificates');
    expect(calls[1].init.method).toBe('POST');
    expect(header(calls[1], 'x-csrf-token')).toBe('tok-1');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ items: [{ productId: 'O26-J-00184', claimCode: '7KQ2-M4TD-9XWH' }], format: 'pdf', layout: 'card' });
    expect(card).toMatchObject({ filename: 'ORBES-certificate-O26-J-00184-PROOF.pdf', contentType: 'application/pdf' });
    const sheet = await api.certificates([{ productId: 'O26-J-00184', claimCode: '7KQ2-M4TD-9XWH' }], { format: 'csv' });
    expect(calls[2].url).not.toContain('7KQ2');
    expect(sheet.filename).toBe('orbes-certificates.csv');
  });

  it('sells from the sale mode (A-08): the register of points of sale, the lookup and the activation', async () => {
    const lookup = { scanId: 's1', state: 'AUTHENTIC', piece: null, sale: { token: 'T'.repeat(43), expiresAt: '2026-10-02T10:10:00.000Z' }, refusal: null };
    const { fetch, calls } = fakeFetch(
      json(200, SESSION),
      json(200, { items: [] }),
      json(200, { items: [] }),
      json(201, { retailer: { id: 'r1' } }),
      json(200, { retailer: { id: 'r1' } }),
      json(200, lookup),
      json(200, { warranty: {}, statusChange: null, scanId: 's1' }),
      json(200, { warranty: {} }),
    );
    const api = new AdminApi({ fetch });
    await api.login('seller@orbes.test', 'pw');
    await api.retailers();
    await api.retailers({ activeOnly: true });
    expect(calls[1].url).toBe('/api/admin/retailers');
    expect(calls[2].url).toBe('/api/admin/retailers?active=true');
    expect(calls[2].init.method).toBe('GET');
    await api.createRetailer({ name: 'ORBES Paris', city: 'Paris', country: 'FR' });
    expect(calls[3]).toMatchObject({ url: '/api/admin/retailers', init: { method: 'POST' } });
    expect(JSON.parse(String(calls[3].init.body))).toEqual({ name: 'ORBES Paris', city: 'Paris', country: 'FR' });
    await api.updateRetailer('r/1', { active: false });
    expect(calls[4]).toMatchObject({ url: '/api/admin/retailers/r%2F1', init: { method: 'PATCH' } });
    expect(JSON.parse(String(calls[4].init.body))).toEqual({ active: false });
    expect(await api.saleLookup({ code: 'abc', genome: { glyphs: [1, 2, 3, 4, 5, 6, 7, 8] }, client: { source: 'camera' } })).toEqual(lookup);
    expect(calls[5]).toMatchObject({ url: '/api/admin/sale/lookup', init: { method: 'POST' } });
    expect(JSON.parse(String(calls[5].init.body))).toEqual({ code: 'abc', genome: { glyphs: [1, 2, 3, 4, 5, 6, 7, 8] }, client: { source: 'camera' } });
    await api.saleActivate('T'.repeat(43), 'r1');
    // The token travels in a POST body, never in a URL.
    expect(calls[6].url).toBe('/api/admin/sale/activate');
    expect(JSON.parse(String(calls[6].init.body))).toEqual({ token: 'T'.repeat(43), retailerId: 'r1' });
    for (const c of calls.slice(3, 7)) expect(header(c, 'x-csrf-token')).toBe('tok-1');
    await api.activateWarranty('O26-J-00184', { purchaseDate: '2026-10-02', retailerId: 'r1' });
    expect(JSON.parse(String(calls[7].init.body))).toEqual({ purchaseDate: '2026-10-02', retailerId: 'r1' });
  });

  it('times out slow requests', async () => {
    vi.useFakeTimers();
    try {
      const fetch: FetchLike = (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      const p = new AdminApi({ fetch, timeoutMs: 1000 }).dashboard();
      const assertion = expect(p).rejects.toMatchObject({ code: 'TIMEOUT' });
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the token on logout even when the request fails', async () => {
    const { fetch } = fakeFetch(json(200, SESSION), new TypeError('offline'));
    const api = new AdminApi({ fetch });
    await api.me();
    await expect(api.logout()).rejects.toMatchObject({ code: 'NETWORK' });
    expect(api.csrfToken).toBeNull();
  });
});
