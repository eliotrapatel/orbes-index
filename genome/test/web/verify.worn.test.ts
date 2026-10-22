/**
 * WORN from the owner's side in the collector app (lot MACRO M2, plan §2.3, step M2.10; macro scope D31 G1 to G3): the
 * pure model (worn-model.ts) and the API calls (api.ts), in vitest's node environment:
 *
 *  - the state a piece's WORN shows, in its order: nothing without a sheet, for a piece no longer held or a test account;
 *    a photograph in review or published first; then a piece reported lost or stolen, in service or with its transfer
 *    pending; a profile without its first name or country; CHOOSE A PHOTOGRAPH, under the reason of the last refusal;
 *  - the credit: exactly the first name and the country in capitals, plus @name when shown (never a variant), written as
 *    the console writes it (admin/model/worn.ts creditLine); the refusals' words the console's own owner words;
 *  - the day a photograph was published, in Paris;
 *  - the preparation's limits, the server's (1 MiB, within its 4 096 px), through the console's encoder (shared/photo.ts);
 *  - GET, POST (the photograph as the body itself, its type its own, the choice and consent in the address, the CSRF
 *    token, a longer timeout) and DELETE, and an answer of the wrong shape refused.
 */
import { describe, expect, it } from 'vitest';
import { WORN_REFUSALS } from '../../src/server/db/schema.js';
import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE } from '../../src/server/media/image.js';
import { WORN_BLOCKS, WORN_CONSENT_VERSION } from '../../src/server/services/worn.js';
import { creditLine as consoleCreditLine, WORN_REFUSAL_WORDS } from '../../src/web/admin/model/worn.js';
import { PHOTO_LIMITS } from '../../src/web/admin/model/photo.js';
import { ApiError, ApiClient, WORN_SEND_TIMEOUT_MS } from '../../src/web/verify/api.js';
import { WORN } from '../../src/web/verify/copy.js';
import type { OwnerWornPhoto, PieceWorn } from '../../src/web/verify/types.js';
import { sendRefusal } from '../../src/web/verify/views/worn.js';
import { REQUEST_ERRORS } from '../../src/web/verify/copy.js';
import { creditLine, draftCredit, instagramHref, instagramOffer, parisDay, refusalWords, WORN_PHOTO_LIMITS, wornPhotoWords, wornState } from '../../src/web/verify/worn-model.js';

const credit = { firstName: 'Camille', country: 'France', instagram: 'camille.m' };

function piece(o: Partial<PieceWorn> = {}): PieceWorn {
  return { sheet: { slug: 'monolithe' }, photo: null, canSend: true, reason: null, credit, consentVersion: WORN_CONSENT_VERSION, ...o };
}

function photo(o: Partial<OwnerWornPhoto> = {}): OwnerWornPhoto {
  return {
    id: '6f1c7a54-3b1e-4c2a-9a55-0d3b1f2e4c5a',
    status: 'PENDING',
    sentAt: '2026-10-03T10:00:00.000Z',
    publishedAt: null,
    endedAt: null,
    refusal: null,
    credit: { firstName: 'Camille', country: 'France', instagram: null },
    url: '/api/v1/account/worn/6f1c7a54-3b1e-4c2a-9a55-0d3b1f2e4c5a/photo',
    width: 1600,
    height: 2000,
    ...o,
  };
}

describe('the state a piece’s WORN shows (worn-model.ts wornState)', () => {
  it('draws nothing without a sheet to show it on, for a piece no longer held, for a test account, nor when it could not be read', () => {
    expect(wornState(null)).toEqual({ kind: 'hidden' });
    expect(wornState(piece({ sheet: null, canSend: false, reason: 'NO_SHEET' }))).toEqual({ kind: 'hidden' });
    expect(wornState(piece({ canSend: false, reason: 'TEST_ENTRANT' }))).toEqual({ kind: 'hidden' });
    expect(wornState(piece({ canSend: false, reason: 'NOT_HELD', photo: photo({ status: 'PUBLISHED' }) }))).toEqual({ kind: 'hidden' });
    // Read between two changes: LIVE, its photograph not yet listed.
    expect(wornState(piece({ canSend: false, reason: 'LIVE' }))).toEqual({ kind: 'hidden' });
  });

  it('shows a photograph in review, then one published with the day it was published in Paris and its sheet', () => {
    const review = wornState(piece({ canSend: false, reason: 'LIVE', photo: photo() }));
    expect(review).toMatchObject({ kind: 'review', credit: { line: 'CAMILLE · FRANCE', handle: null, href: null } });
    const published = wornState(piece({ canSend: false, reason: 'LIVE', photo: photo({ status: 'PUBLISHED', publishedAt: '2026-10-20T23:30:00.000Z', credit }) }));
    expect(published).toMatchObject({ kind: 'published', since: '21 OCT 2026', sheet: 'monolithe', credit: { line: 'CAMILLE · FRANCE', handle: '@camille.m', href: 'https://www.instagram.com/camille.m/' } });
    expect(WORN.publishedSince('21 OCT 2026')).toBe('In WORN since 21 OCT 2026.');
    // A photograph live on a piece reported since keeps WITHDRAW: it is shown first.
    expect(wornState(piece({ canSend: false, reason: 'STATUS', photo: photo({ status: 'PUBLISHED', publishedAt: '2026-10-04T09:12:00.000Z' }) })).kind).toBe('published');
  });

  it('keeps a live photograph and its WITHDRAW when the model’s sheet has gone (terms article 15), without SEE IT ON THE SHEET', () => {
    const published = wornState(piece({ sheet: null, canSend: false, reason: 'NO_SHEET', photo: photo({ status: 'PUBLISHED', publishedAt: '2026-10-20T09:00:00.000Z' }) }));
    expect(published).toMatchObject({ kind: 'published', sheet: null });
    expect(wornState(piece({ sheet: null, canSend: false, reason: 'NO_SHEET', photo: photo() })).kind).toBe('review');
    // Settled photographs draw nothing without a sheet.
    expect(wornState(piece({ sheet: null, canSend: false, reason: 'NO_SHEET', photo: photo({ status: 'REFUSED', refusal: 'QUALITY', url: null }) }))).toEqual({ kind: 'hidden' });
  });

  it('says what stops a sending, in one calm sentence, and YOUR PROFILE for a credit that cannot be written', () => {
    expect(wornState(piece({ canSend: false, reason: 'STATUS' }))).toEqual({ kind: 'blocked', text: WORN.status, refused: null });
    expect(wornState(piece({ canSend: false, reason: 'TRANSFER_PENDING' }))).toEqual({ kind: 'blocked', text: WORN.transfer, refused: null });
    expect(wornState(piece({ canSend: false, reason: 'PROFILE_INCOMPLETE', credit: { firstName: null, country: 'France', instagram: null } }))).toEqual({ kind: 'profile', text: WORN.profile, refused: null });
  });

  it('offers CHOOSE A PHOTOGRAPH, and CHOOSE ANOTHER PHOTOGRAPH under the reason ORBES gave (refused or taken down)', () => {
    expect(wornState(piece())).toEqual({ kind: 'choose', action: WORN.choose, refused: null });
    const refused = wornState(piece({ photo: photo({ status: 'REFUSED', refusal: 'PIECE_NOT_VISIBLE', url: null }) }));
    expect(refused).toEqual({ kind: 'choose', action: WORN.chooseAnother, refused: { head: WORN.notPublished, text: 'The piece is not clearly visible.' } });
    const takenDown = wornState(piece({ photo: photo({ status: 'TAKEN_DOWN', refusal: 'NOT_SUITABLE', url: null }) }));
    expect(takenDown).toMatchObject({ kind: 'choose', action: WORN.chooseAnother, refused: { text: 'This photograph cannot be shown in WORN.' } });
    // The reason stays above what stops the next sending.
    expect(wornState(piece({ canSend: false, reason: 'PROFILE_INCOMPLETE', photo: photo({ status: 'REFUSED', refusal: 'QUALITY', url: null }) }))).toMatchObject({ kind: 'profile', refused: { text: 'The photograph is not sharp enough.' } });
  });

  it('knows every reason the server gives', () => {
    const known = new Set(['NO_SHEET', 'TEST_ENTRANT', 'NOT_HELD', 'STATUS', 'TRANSFER_PENDING', 'PROFILE_INCOMPLETE', 'LIVE']);
    expect([...WORN_BLOCKS].sort()).toEqual([...known].sort());
  });
});

describe('the credit under a photograph (G3)', () => {
  it('is exactly the first name and the country in capitals, plus @name when shown, as the console writes it', () => {
    const cases = [
      { firstName: 'Camille', country: 'France', instagram: null },
      { firstName: ' Inès ', country: 'United Kingdom', instagram: 'ines.fabre_' },
      { firstName: 'Maximiliana-Alexandrina de la Rochefoucauld-Liancourt', country: 'South Georgia and the South Sandwich Islands', instagram: 'a'.repeat(30) },
    ];
    for (const c of cases) expect(creditLine(c), c.firstName).toEqual(consoleCreditLine(c));
    expect(creditLine(cases[1]!)).toEqual({ line: 'INÈS · UNITED KINGDOM', handle: '@ines.fabre_', href: 'https://www.instagram.com/ines.fabre_/' });
    expect(instagramHref('camille.m')).toBe('https://www.instagram.com/camille.m/');
  });

  it('previews the credit a sending carries, its Instagram name only when SHOW MY INSTAGRAM is on, and offers it only with one', () => {
    expect(draftCredit(piece(), false)).toEqual({ line: 'CAMILLE · FRANCE', handle: null, href: null });
    expect(draftCredit(piece(), true)?.handle).toBe('@camille.m');
    expect(draftCredit(piece({ credit: { firstName: 'Camille', country: null, instagram: null } }), true)).toBeNull();
    expect(instagramOffer(piece())).toBe('@camille.m');
    expect(instagramOffer(piece({ credit: { ...credit, instagram: null } }))).toBeNull();
  });

  it('says each refusal in the console’s owner words, for every reason the server has', () => {
    expect(Object.keys(WORN.refusal).sort()).toEqual([...WORN_REFUSALS].sort());
    for (const r of WORN_REFUSALS) {
      expect(WORN.refusal[r]).toBe(WORN_REFUSAL_WORDS[r].owner);
      expect(refusalWords(r)).toBe(WORN_REFUSAL_WORDS[r].owner);
    }
    expect(refusalWords(null)).toBeNull();
  });
});

describe('the day in Paris', () => {
  it('reads the day of the publication in Paris, summer and winter', () => {
    expect(parisDay('2026-10-04T09:12:00.000Z')).toBe('4 OCT 2026');
    expect(parisDay('2026-10-20T22:30:00.000Z')).toBe('21 OCT 2026');
    expect(parisDay('2026-12-31T22:59:00.000Z')).toBe('31 DEC 2026');
    expect(parisDay('2026-12-31T23:00:00.000Z')).toBe('1 JAN 2027');
    expect(parisDay('not a date')).toBe('');
  });
});

describe('the photograph prepared on the device (shared/photo.ts)', () => {
  it('fits the server’s image routes: 1 MiB, 2 000 px within its 4 096, the console’s qualities', () => {
    expect(WORN_PHOTO_LIMITS.maxBytes).toBe(MAX_IMAGE_BYTES);
    expect(Math.max(...WORN_PHOTO_LIMITS.sides)).toBeLessThanOrEqual(MAX_IMAGE_SIDE);
    expect(WORN_PHOTO_LIMITS.sides).toEqual(PHOTO_LIMITS.sides);
    expect(WORN_PHOTO_LIMITS.qualities).toEqual(PHOTO_LIMITS.qualities);
    expect(WORN_PHOTO_LIMITS.tooLarge).toBe(WORN.tooLarge);
    expect(wornPhotoWords()).toEqual({ unreadable: WORN.unreadable, empty: WORN.unreadable, noCanvas: WORN.noCanvas });
    // The phone's words (the tests read as a phone).
    expect(WORN.unreadable).toBe('This photograph cannot be read. Choose a JPEG or a photograph from your library.');
  });
});

describe('WORN’s calls (api.ts)', () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  function fakeApi(responses: (() => Response)[]) {
    const calls: { url: string; method: string; body: BodyInit | null | undefined; type: string | undefined; csrf: string | undefined; signal: AbortSignal | null | undefined }[] = [];
    const api = new ApiClient({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body, type: headers['content-type'], csrf: headers['x-csrf-token'], signal: init?.signal });
        const r = responses.shift();
        if (!r) throw new Error(`unexpected request ${String(input)}`);
        return r();
      }) as typeof fetch,
    });
    return { api, calls };
  }

  it('reads the piece’s WORN, sends the photograph as itself with the choice and the consent in the address, and withdraws it', async () => {
    const answer = piece({ canSend: false, reason: 'LIVE', photo: photo() });
    const { api, calls } = fakeApi([
      () => json(200, { account: { email: 'you@example.com', displayName: null }, csrfToken: 't1' }),
      () => json(200, piece()),
      () => json(201, answer),
      () => new Response(null, { status: 204 }),
    ]);
    await api.me();
    expect(await api.wornOfPiece('O26-J-00184')).toEqual(piece());
    expect(calls[1]).toMatchObject({ url: '/api/v1/account/products/O26-J-00184/worn', method: 'GET', body: undefined, csrf: undefined });
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
    expect(await api.sendWorn('O26-J-00184', blob, { instagram: true, consent: WORN_CONSENT_VERSION })).toEqual(answer);
    expect(calls[2]).toMatchObject({ url: `/api/v1/account/products/O26-J-00184/worn?instagram=1&consent=${WORN_CONSENT_VERSION}`, method: 'POST', type: 'image/jpeg', csrf: 't1' });
    expect(calls[2]!.body).toBe(blob);
    await api.withdrawWorn(answer.photo!.id);
    expect(calls[3]).toMatchObject({ url: `/api/v1/account/worn/${answer.photo!.id}`, method: 'DELETE', csrf: 't1' });
    expect(WORN_SEND_TIMEOUT_MS).toBeGreaterThan(15_000);
  });

  it('sends instagram=0 when the name is not shown, says the server’s refusals in its words, and refuses an answer of the wrong shape', async () => {
    const { api, calls } = fakeApi([
      () => json(429, { error: { code: 'WORN_LIMIT', message: 'You can send 5 photographs in 24 hours. Try again later.' } }),
      () => json(200, { sheet: null, photo: null }),
      () => json(200, { ...piece(), photo: { id: 1 } }),
    ]);
    const blob = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
    await expect(api.sendWorn('O26-J-00184', blob, { instagram: false, consent: WORN_CONSENT_VERSION })).rejects.toMatchObject({ status: 429, code: 'WORN_LIMIT', message: 'You can send 5 photographs in 24 hours. Try again later.' });
    expect(calls[0]!.url).toContain('instagram=0');
    await expect(api.wornOfPiece('O26-J-00184')).rejects.toBeInstanceOf(ApiError);
    await expect(api.wornOfPiece('O26-J-00184')).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('says the 24-hour limit in the server’s words, a body too large as the preparation does, the rest as every form', () => {
    expect(sendRefusal(new ApiError(429, 'WORN_LIMIT', 'You can send 5 photographs in 24 hours. Try again later.'))).toBe('You can send 5 photographs in 24 hours. Try again later.');
    expect(sendRefusal(new ApiError(429, 'RATE_LIMITED', 'Slow down.'))).toBe(REQUEST_ERRORS.rateLimited);
    expect(sendRefusal(new ApiError(413, 'HTTP_413', 'The request could not be completed.'))).toBe(WORN.tooLarge);
    expect(sendRefusal(new ApiError(0, 'NETWORK', 'The service could not be reached.'))).toBe(REQUEST_ERRORS.network);
    expect(sendRefusal(new ApiError(409, 'WORN_ALREADY', 'This piece already has a photograph in WORN or in review. Withdraw it to send another.'))).toBe('This piece already has a photograph in WORN or in review. Withdraw it to send another.');
  });

  it('sends JSON as before everywhere else', async () => {
    const { api, calls } = fakeApi([() => json(202, { ok: true })]);
    await api.requestReset('you@example.com');
    expect(calls[0]).toMatchObject({ type: 'application/json', body: JSON.stringify({ email: 'you@example.com' }) });
  });
});
