/**
 * THE RELEASES (P-R03): the list, a release's page and the account's entries as /verify shows them
 * (releases-model.ts): the addresses, the times in UTC then on the phone's clock, the facts of a release, the seed only
 * once drawn, the draw's list, and what an entry means now (ENTER THE DRAW, WITHDRAW, a place held with the contact of
 * ORBES Client Services); the copy held to the lexicon (DRAW, never "lottery") and the rule it states held to the
 * server's. Pure: no DOM. The pages are driven in Chromium by verify.e2e.test.ts.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { dropNotFound, drawOrder } from '../../src/server/services/drops.js';
import { RELEASES } from '../../src/web/verify/copy.js';
import {
  drawLines,
  entryModel,
  groupHex,
  isReleaseId,
  myEntries,
  releaseCards,
  releasePath,
  RELEASES_PATH,
  releaseSheet,
  releasesRouteOf,
  tierLabel,
  twoClocks,
} from '../../src/web/verify/releases-model.js';
import type { ClubEntry, DropCard, DropSheet } from '../../src/web/verify/types.js';
import { brandForbiddenTerms, EXTRA_FORBIDDEN_EN, findForbidden } from '../docs/lexicon.js';

const ID = '8a1d0c55-4b2e-4f3a-9c1d-0e5f6a7b8c9d';
const ENTRY = '3f9a1c2e-7b6d-4e5f-8a9b-0c1d2e3f4a5b';
const media = (n: number) => `/api/v1/media/${n.toString(16).padStart(2, '0').repeat(32)}`;
const HASH = 'ab'.repeat(32);

function card(extra: Partial<DropCard> = {}): DropCard {
  return {
    id: ID,
    title: 'Monolithe — release I',
    state: 'OPEN',
    model: { name: 'Monolithe', type: 'Ring', collection: 'Orbit 2026', imageUrl: media(1), lookbook: 'monolithe' },
    quantity: 3,
    opensAt: '2026-10-12T10:00:00.000Z',
    closesAt: '2026-10-14T10:00:00.000Z',
    ...extra,
  };
}

function sheet(extra: Partial<DropSheet> = {}): DropSheet {
  return {
    ...card(),
    description: 'Three pieces.\n\nCast in Paris.',
    purchaseWindowHours: 48,
    publishedAt: '2026-10-05T10:00:00.000Z',
    cancelledAt: null,
    drawnAt: null,
    seedHash: HASH,
    seed: null,
    entries: null,
    ...extra,
  };
}

function entry(extra: Partial<ClubEntry> = {}): ClubEntry {
  return {
    id: ENTRY,
    dropId: ID,
    title: 'Monolithe — release I',
    state: 'OPEN',
    status: 'ENTERED',
    enteredAt: '2026-10-12T11:00:00.000Z',
    rank: null,
    respondBy: null,
    opensAt: '2026-10-12T10:00:00.000Z',
    closesAt: '2026-10-14T10:00:00.000Z',
    drawnAt: null,
    ...extra,
  };
}

describe('the releases\' addresses (P-R03)', () => {
  it('reads the list and a release by its id under /verify/releases; anything else under it is the list', () => {
    expect(RELEASES_PATH).toBe('/verify/releases');
    expect(releasePath(ID)).toBe(`/verify/releases/${ID}`);
    expect(releasesRouteOf('/verify/releases')).toEqual({ release: null });
    expect(releasesRouteOf('/verify/releases/')).toEqual({ release: null });
    expect(releasesRouteOf(`/verify/releases/${ID.toUpperCase()}/`)).toEqual({ release: ID });
    expect(releasesRouteOf('/verify/releases/not-a-release')).toEqual({ release: null });
    expect(releasesRouteOf('/verify/lookbook')).toBeNull();
    expect(releasesRouteOf('/verify/releasesx')).toBeNull();
    expect(isReleaseId(ID)).toBe(true);
    expect(isReleaseId(ID.toUpperCase())).toBe(false);
  });
});

describe('the releases\' list and pages (P-R03)', () => {
  it('says a time in UTC, then on this phone\'s clock with its offset', () => {
    expect(twoClocks('2026-10-12T10:00:00.000Z', 120)).toEqual({ utc: '12 OCT 2026 · 10:00 UTC', local: '12 OCT 2026 · 12:00 on this phone (UTC+02:00)' });
    expect(twoClocks('2026-10-12T10:00:00.000Z', -270)).toEqual({ utc: '12 OCT 2026 · 10:00 UTC', local: '12 OCT 2026 · 05:30 on this phone (UTC-04:30)' });
    expect(twoClocks('2026-10-12T10:00:00.000Z', 0)).toEqual({ utc: '12 OCT 2026 · 10:00 UTC', local: null });
    expect(twoClocks('nonsense', 60)).toEqual({ utc: '', local: null });
  });

  it('lists each release with its state, model, pieces and the time that matters now; a photograph from the media route only', () => {
    const [open, upcoming, drawn] = releaseCards([card(), card({ id: ID.replace('8a1d', '8a1e'), state: 'UPCOMING' }), card({ id: ID.replace('8a1d', '8a1f'), state: 'DRAWN', quantity: 1, model: { ...card().model, imageUrl: 'https://elsewhere.example/x.jpg' } })]);
    expect(open).toEqual({
      id: ID,
      href: `/verify/releases/${ID}`,
      title: 'MONOLITHE — RELEASE I',
      state: 'OPEN',
      stateLabel: 'ENTRIES OPEN',
      model: 'MONOLITHE · RING',
      line: '3 PIECES · ENTRIES CLOSE 14 OCT 2026 · 10:00 UTC',
      image: { src: media(1), alt: 'The model of MONOLITHE — RELEASE I, photographed by ORBES' },
    });
    expect(upcoming).toMatchObject({ stateLabel: 'ENTRIES OPEN SOON', line: '3 PIECES · ENTRIES OPEN 12 OCT 2026 · 10:00 UTC' });
    expect(drawn).toMatchObject({ stateLabel: 'DRAWN', line: '1 PIECE', image: null });
    // A release without an id of its own is left out.
    expect(releaseCards([card({ id: 'nope' }), card({ title: undefined as unknown as string })])).toEqual([]);
  });

  it('gives a release\'s facts, its model\'s sheet when it is public, and its seed only once drawn', () => {
    const s = releaseSheet(sheet(), 120);
    expect(s).toMatchObject({ id: ID, title: 'MONOLITHE — RELEASE I', state: 'OPEN', stateLabel: 'ENTRIES OPEN', eyebrow: 'ORBIT 2026', model: 'MONOLITHE · RING', lookbookSlug: 'monolithe', drawn: false, seed: null, seedHex: null, entries: null });
    expect(s.rows).toEqual([
      { label: 'PIECES', value: '3' },
      { label: 'ENTRIES OPEN', value: '12 OCT 2026 · 10:00 UTC', local: '12 OCT 2026 · 12:00 on this phone (UTC+02:00)' },
      { label: 'ENTRIES CLOSE', value: '14 OCT 2026 · 10:00 UTC', local: '14 OCT 2026 · 12:00 on this phone (UTC+02:00)' },
      { label: 'PLACE HELD', value: '48 HOURS' },
    ]);
    expect(s.seedHash).toBe(groupHex(HASH));
    expect(s.seedHash.split(' ')).toHaveLength(16);
    // A seed sent before the draw is not shown; once drawn it is, with the draw's time and the entries counted.
    expect(releaseSheet(sheet({ seed: 'cd'.repeat(32) }), 0).seed).toBeNull();
    const d = releaseSheet(sheet({ state: 'DRAWN', seed: 'cd'.repeat(32), drawnAt: '2026-10-14T12:00:00.000Z', entries: 7 }), 0);
    expect(d).toMatchObject({ drawn: true, seedHex: 'cd'.repeat(32), seed: groupHex('cd'.repeat(32)), entries: 7 });
    expect(d.rows.at(-1)).toEqual({ label: 'DRAWN', value: '14 OCT 2026 · 12:00 UTC', local: null });
    // No collection: the model's name over the title; an address that is none: no link to a sheet.
    expect(releaseSheet(sheet({ model: { ...card().model, collection: null, lookbook: 'Not One' } }), 0)).toMatchObject({ eyebrow: 'MONOLITHE', lookbookSlug: null });
    expect(releaseSheet(sheet({ purchaseWindowHours: 1 }), 0).rows[3]).toEqual({ label: 'PLACE HELD', value: '1 HOUR' });
  });

  it('lists the draw\'s entries by rank, tier and seniority, the account\'s own marked', () => {
    expect([0, 1, 2, 3].map(tierLabel)).toEqual(['NO TIER', 'TITANE', 'PLATINE', 'PALLADIUM']);
    const lines = drawLines(
      [
        { id: ENTRY, tier: 3, seniority: 2, rank: 1 },
        { id: ID, tier: 0, seniority: 1, rank: 2 },
        { id: 'nope', tier: 1, seniority: 0, rank: 3 },
      ],
      ID,
    );
    expect(lines).toEqual([
      { id: ENTRY, rank: 1, line: '1 · PALLADIUM · 2 YEARS', yours: false },
      { id: ID, rank: 2, line: '2 · NO TIER · 1 YEAR', yours: true },
    ]);
  });
});

describe('an account\'s entry (P-R03)', () => {
  const release = { id: ID, title: 'MONOLITHE — RELEASE I', state: 'OPEN' as const, opensAt: '2026-10-12T10:00:00.000Z' };
  const opts = { offsetMinutes: 120, clientServices: { email: 'support@theorbes.com', hours: 'Monday to Friday, 10:00–18:00' } };

  it('offers ENTER THE DRAW while entries are open, WITHDRAW until the draw, and says when entries open', () => {
    expect(entryModel(release, null, opts)).toMatchObject({ label: null, canEnter: true, canWithdraw: false, sentence: RELEASES.status.open });
    expect(entryModel({ ...release, state: 'UPCOMING' }, null, opts)).toMatchObject({ canEnter: false, sentence: 'Entries open on 12 October 2026, 12:00 (UTC+02:00).' });
    expect(entryModel({ ...release, state: 'CLOSED' }, null, opts)).toMatchObject({ canEnter: false, sentence: 'Entries are closed. The draw follows.' });
    expect(entryModel({ ...release, state: 'DRAWN' }, null, opts).sentence).toBe('The draw has taken place.');
    expect(entryModel(release, entry(), opts)).toMatchObject({ label: 'ENTERED', entryId: ENTRY, canEnter: false, canWithdraw: true, contact: null });
    expect(entryModel({ ...release, state: 'CLOSED' }, entry(), opts)).toMatchObject({ canWithdraw: true, sentence: 'You are entered in the draw, which follows the close of entries.' });
    expect(entryModel(release, entry({ status: 'WITHDRAWN' }), opts)).toMatchObject({ label: 'WITHDRAWN', canEnter: true, canWithdraw: false });
    expect(entryModel({ ...release, state: 'CLOSED' }, entry({ status: 'WITHDRAWN' }), opts)).toMatchObject({ canEnter: false, sentence: 'You withdrew from this draw.' });
    expect(entryModel({ ...release, state: 'CANCELLED' }, entry(), opts)).toMatchObject({ canEnter: false, canWithdraw: false, sentence: 'This release has been cancelled: there will be no draw.' });
  });

  it('holds a place until its time, ORBES Client Services will contact the account, with their contact; then the waiting list, the sale, the lapse', () => {
    const held = entryModel({ ...release, state: 'DRAWN' }, entry({ status: 'SELECTED', rank: 1, respondBy: '2026-10-16T12:00:00.000Z' }), opts);
    expect(held).toMatchObject({ label: 'PLACE HELD', canEnter: false, canWithdraw: false });
    expect(held.sentence).toBe('Your place is held until 16 October 2026, 14:00 (UTC+02:00) — ORBES Client Services will contact you.');
    expect(held.contact).toMatchObject({ placement: 'release' });
    const mailto = decodeURIComponent(held.contact!.mailto!);
    expect(mailto).toContain('subject=ORBES — MONOLITHE — RELEASE I — PLACE HELD');
    expect(mailto).toContain(`ENTRY: ${ENTRY}`);
    expect(entryModel({ ...release, state: 'DRAWN' }, entry({ status: 'SELECTED', respondBy: '2026-10-16T12:00:00.000Z' }), { offsetMinutes: 0 }).contact).toBeNull();
    expect(entryModel({ ...release, state: 'DRAWN' }, entry({ status: 'WAITLISTED', rank: 4 }), opts).sentence).toBe('You are on the waiting list, rank 4. ORBES Client Services will contact you if a place opens.');
    expect(entryModel({ ...release, state: 'DRAWN' }, entry({ status: 'CONFIRMED', rank: 1 }), opts)).toMatchObject({ label: 'CONCLUDED', sentence: RELEASES.status.confirmed });
    expect(entryModel({ ...release, state: 'DRAWN' }, entry({ status: 'LAPSED', rank: 2 }), opts)).toMatchObject({ label: 'LAPSED', sentence: RELEASES.status.lapsed });
  });

  it('groups the account\'s entries for MY PIECES, each with its release\'s page', () => {
    const list = myEntries([entry(), entry({ dropId: 'nope' }), entry({ id: ID, dropId: ID.replace('8a1d', '8a1e'), state: 'DRAWN', status: 'WAITLISTED', rank: 2 })], opts);
    expect(list.map((e) => [e.href, e.stateLabel, e.entry.label])).toEqual([
      [`/verify/releases/${ID}`, 'ENTRIES OPEN', 'ENTERED'],
      [`/verify/releases/${ID.replace('8a1d', '8a1e')}`, 'DRAWN', 'WAITING LIST'],
    ]);
  });
});

describe('the releases\' copy (P-R03)', () => {
  const lines = Object.values(RELEASES).flatMap((v): string[] => {
    if (typeof v === 'string') return [v];
    if (typeof v === 'function') return [String((v as (...a: unknown[]) => string)(3, 'MONOLITHE', 'UTC+02:00'))];
    return Object.values(v as Record<string, unknown>).map((x) => (typeof x === 'function' ? String((x as (a: unknown) => string)(3)) : String(x)));
  });

  it('writes no word of BRAND §4.5 (nor "product"), no exclamation mark, and DRAW, never "lottery"', () => {
    expect(lines.length).toBeGreaterThan(40);
    expect(findForbidden(lines.join('\n'), [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN])).toEqual([]);
    expect(lines.join('\n')).not.toMatch(/!|lotter|raffle|sweepstake/i);
    expect(RELEASES.enter).toBe('ENTER THE DRAW');
    expect(RELEASES.status.selected('16 October 2026, 14:00 (UTC+02:00)')).toBe('Your place is held until 16 October 2026, 14:00 (UTC+02:00) — ORBES Client Services will contact you.');
    // The server's 404 says what the page says.
    expect(dropNotFound().publicMessage).toBe(RELEASES.notFound);
    expect(dropNotFound()).toMatchObject({ code: 'DROP_NOT_FOUND', httpStatus: 404 });
  });

  it('states the rule the server applies: the tier, the seniority, then SHA-256 of the seed and the entry\'s id in lower case', () => {
    for (const s of ['PALLADIUM', 'PLATINE', 'TITANE', 'seniority', 'SHA-256 of the 32 bytes of the seed', 'lower-case', 'increasing hexadecimal order', 'moment of the draw', 'waiting list']) {
      expect(RELEASES.rule, s).toContain(s);
    }
    // The server's order, from what the page publishes: the seed and each entry's id, tier and seniority.
    const seed = new Uint8Array(32).fill(9);
    const ids = [ENTRY, ID];
    const keys = ids.map((id) => createHash('sha256').update(Buffer.concat([Buffer.from(seed), Buffer.from(id, 'ascii')])).digest('hex'));
    const order = drawOrder(ids.map((id) => ({ id, tier: 1, seniority: 0 })), seed);
    expect(order.map((e) => e.id)).toEqual(keys[0]! < keys[1]! ? ids : [...ids].reverse());
  });
});
