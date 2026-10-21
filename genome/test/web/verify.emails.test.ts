/**
 * The collector's side of the emails (macro scope E1–E3; lot M1 plan §4.4, step M1.19): the links' fragments
 * (reset-model.ts), RESET BY EMAIL's offer read once a page load, the API calls of the reset, YOUR PROFILE's release
 * notices and STOP THESE EMAILS, and their words (copy.ts), held to the server's.
 */
import { describe, expect, it } from 'vitest';
import { ApiClient, ApiError } from '../../src/web/verify/api.js';
import { ACCOUNT_PASSWORD, ACCOUNT_RESET, RELEASE_NOTICES, UNSUBSCRIBE } from '../../src/web/verify/copy.js';
import { isResetPath, isUnsubscribePath, readResetOffer, resetLinkOf, resetOffered, resetOfferKnown, unsubscribeTokenOf } from '../../src/web/verify/reset-model.js';
import { pageOf } from '../../src/web/verify/seen-model.js';
import { resetLink } from '../../src/server/services/account-recovery.js';
import { EMAIL_FRAME } from '../../src/server/email/copy.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeApi(responses: (() => Response)[]) {
  const calls: { url: string; method: string; body: unknown; csrf: string | undefined }[] = [];
  const api = new ApiClient({
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(input), method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined, csrf: headers['x-csrf-token'] });
      const r = responses.shift();
      if (!r) throw new Error(`unexpected request ${String(input)}`);
      return r();
    }) as typeof fetch,
  });
  return { api, calls };
}

describe('the emails’ links (reset-model.ts)', () => {
  it('reads the email and code of the reset link the server writes, and nothing else', () => {
    const link = resetLink('https://verify.theorbes.com', 'Camille.Laurent+orbes@example.com', '7K3M-Q9TD-2WXA');
    const hash = link.slice(link.indexOf('#'));
    expect(resetLinkOf(hash)).toEqual({ email: 'Camille.Laurent+orbes@example.com', code: '7K3M-Q9TD-2WXA' });
    // Any case, with or without its dashes.
    expect(resetLinkOf('#you%40example.com/7k3mq9td2wxa')).toEqual({ email: 'you@example.com', code: '7K3M-Q9TD-2WXA' });
    for (const bad of ['', '#', '#you%40example.com', '#you%40example.com/', '#/7K3M-Q9TD-2WXA', '#you%40example.com/7K3M-Q9TD-2WX', '#you%40example.com/7K3M-Q9TD-2WXAB', '#not-an-email/7K3M-Q9TD-2WXA', '#you%40example.com/7K3M Q9TD 2WXA', '#%E0%A4%A/7K3M-Q9TD-2WXA']) {
      expect(resetLinkOf(bad), bad).toBeNull();
    }
  });

  it('reads an unsubscribe token as it stands in the fragment, and refuses what no token is', () => {
    expect(unsubscribeTokenOf('#r.6f1c7a54-3b1e-4c2a-9a55-0d3b1f2e4c5a.AbC-_d')).toBe('r.6f1c7a54-3b1e-4c2a-9a55-0d3b1f2e4c5a.AbC-_d');
    expect(unsubscribeTokenOf('#')).toBeNull();
    expect(unsubscribeTokenOf('#a b')).toBeNull();
    expect(unsubscribeTokenOf(`#${'a'.repeat(121)}`)).toBeNull();
  });

  it('names the pages’ addresses, any case, a slash at the end or not', () => {
    expect(isResetPath('/verify/reset')).toBe(true);
    expect(isResetPath('/verify/Reset/')).toBe(true);
    expect(isUnsubscribePath('/verify/unsubscribe')).toBe(true);
    expect(isResetPath('/verify/reset/x')).toBe(false);
  });

  it('never records the emails’ pages (SET A NEW PASSWORD, STOP THESE EMAILS)', () => {
    const state = { piecesTab: 'pieces' as const, pieceId: null, sheetSlug: null, releaseId: null, releaseAfterRoom: false, liveRoom: false, postId: null };
    expect(pageOf('reset', state)).toBeNull();
    expect(pageOf('unsubscribe', state)).toBeNull();
  });
});

describe('RESET BY EMAIL offered or not (GET /api/v1/account/reset)', () => {
  it('is read once a page load and shared by every sign-in; off when it cannot be read, read again next time', async () => {
    const { api, calls } = fakeApi([() => json(200, { email: true })]);
    expect(resetOfferKnown(api)).toBeUndefined();
    const [a, b] = await Promise.all([readResetOffer(api), resetOffered(api)]);
    expect([a, b]).toEqual([true, true]);
    expect(resetOfferKnown(api)).toBe(true);
    expect(calls).toHaveLength(1);

    const failing = fakeApi([() => json(500, {}), () => json(200, { email: false })]);
    expect(await readResetOffer(failing.api)).toBe(false);
    expect(await readResetOffer(failing.api)).toBe(false);
    expect(failing.calls).toHaveLength(2);
  });
});

describe('the API calls (lot M1, E1–E3)', () => {
  it('asks for a reset link with the address alone, no CSRF (no session), and reads EMAIL_OFF as the server says it', async () => {
    const { api, calls } = fakeApi([() => json(202, { ok: true }), () => json(409, { error: { code: 'EMAIL_OFF', message: 'Emails are not sent yet.' } })]);
    await api.requestReset('you@example.com');
    expect(calls[0]).toMatchObject({ url: '/api/v1/account/reset-request', method: 'POST', body: { email: 'you@example.com' }, csrf: undefined });
    await expect(api.requestReset('you@example.com')).rejects.toMatchObject({ code: 'EMAIL_OFF', status: 409 });
  });

  it('reads and switches EMAIL ME WHEN A RELEASE IS ANNOUNCED, the switch with the session’s CSRF token', async () => {
    const { api, calls } = fakeApi([
      () => json(200, { account: { email: 'you@example.com', displayName: null }, csrfToken: 't1' }),
      () => json(200, { releaseNotices: false, changedAt: null }),
      () => json(200, { releaseNotices: true, changedAt: '2026-10-05T16:49:00.000Z' }),
      () => json(200, { releaseNotices: 'yes' }),
    ]);
    await api.me();
    expect(await api.emailPreferences()).toEqual({ releaseNotices: false, changedAt: null });
    expect(await api.setReleaseNotices(true)).toEqual({ releaseNotices: true, changedAt: '2026-10-05T16:49:00.000Z' });
    expect(calls[2]).toMatchObject({ url: '/api/v1/account/email-preferences', method: 'PUT', body: { releaseNotices: true }, csrf: 't1' });
    await expect(api.emailPreferences()).rejects.toBeInstanceOf(ApiError);
  });

  it('reads what a STOP THESE EMAILS link stops (its token encoded), and STOP posts the token alone', async () => {
    const { api, calls } = fakeApi([() => json(200, { kind: 'RELEASE_NOTICE' }), () => json(200, { kind: null }), () => json(200, { kind: 'ORDER_SHIPPED' }), () => json(200, { ok: true })]);
    expect(await api.unsubscribeKind('r.a+b')).toBe('RELEASE_NOTICE');
    expect(calls[0]!.url).toBe('/api/v1/email/unsubscribe?t=r.a%2Bb');
    expect(await api.unsubscribeKind('x')).toBeNull();
    await expect(api.unsubscribeKind('y')).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    await api.unsubscribe('r.a');
    expect(calls[3]).toMatchObject({ url: '/api/v1/email/unsubscribe', method: 'POST', body: { token: 'r.a' } });
  });
});

describe('the words (copy.ts)', () => {
  it('says the reset’s page with the recovery’s own words, and the same sentence for any address', () => {
    expect(ACCOUNT_RESET.title).toBe(ACCOUNT_PASSWORD.recoverTitle);
    expect(ACCOUNT_RESET.newPassword).toBe(ACCOUNT_PASSWORD.newPassword);
    expect(ACCOUNT_RESET.sent).toBe('If an account uses this address, a link is on its way. It works for 30 minutes.');
    expect(ACCOUNT_RESET.pageLead('you@example.com')).toBe('For the ORBES account you@example.com.');
  });

  it('names what each link stops, as the emails name why they are received, and STOP THESE EMAILS as their link does', () => {
    expect(UNSUBSCRIBE.plain).toBe(EMAIL_FRAME.stop);
    expect(UNSUBSCRIBE.ask).toBe(`${EMAIL_FRAME.stop}?`);
    expect(Object.keys(UNSUBSCRIBE.kind).sort()).toEqual(['FOUNDING_ANNOUNCEMENT', 'RELEASE_NOTICE']);
    expect(Object.keys(UNSUBSCRIBE.stopped).sort()).toEqual(['FOUNDING_ANNOUNCEMENT', 'RELEASE_NOTICE']);
    // The release notices' email says they were asked for in YOUR PROFILE: the page says where to switch them on again.
    expect(EMAIL_FRAME.reason.RELEASE_NOTICE).toContain('YOUR PROFILE');
    expect(UNSUBSCRIBE.again).toContain('YOUR PROFILE');
    expect(RELEASE_NOTICES.label).toBe('EMAIL ME WHEN A RELEASE IS ANNOUNCED');
  });
});
