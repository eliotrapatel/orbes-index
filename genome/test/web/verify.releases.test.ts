/**
 * THE RELEASES (P-R03): the list, a release's page and the account's entries as /verify shows them
 * (releases-model.ts): the addresses, the times in UTC then on the phone's clock, the facts of a release, the seed only
 * once drawn, the draw's list, and what an entry means now (ENTER THE DRAW, WITHDRAW, a place held with the contact of
 * ORBES Client Services); the copy held to the lexicon (DRAW, never "lottery") and the rule it states held to the
 * server's. The early access (P-X02): the line PLATINE AND PALLADIUM: FROM … · EVERYONE: FROM …, its facts, EARLY
 * ACCESS while it lasts, EVERY PIECE RESERVED once full, RESERVE A PLACE for a PLATINE or PALLADIUM account only, and
 * the place reserved. Pure: no DOM. The pages are driven in Chromium by verify.e2e.test.ts.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { dropNotFound, drawOrder } from '../../src/server/services/drops.js';
import { RELEASES } from '../../src/web/verify/copy.js';
import {
  drawLines,
  drawStoryModel,
  earlyAccessOf,
  entryModel,
  type EarlyAccess,
  groupHex,
  isReleaseId,
  myEntries,
  drawPrice,
  releaseCards,
  releasePath,
  RELEASES_PATH,
  releaseSheet,
  releasesRouteOf,
  afterRoomPath,
  participationModel,
  pastCards,
  PastPages,
  PAST_PAGE_SIZE,
  tierLabel,
  twoClocks,
  zonedDate,
} from '../../src/web/verify/releases-model.js';
import type { ClubEntry, DropCard, DropSheet, PastRelease } from '../../src/web/verify/types.js';
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
    // A release published without an early access (P-X02): the tests of P-R03 read it as they did.
    earlyAccessHours: 0,
    earlyAccessOpensAt: null,
    earlyAccessOpen: false,
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
    reserved: 0,
    ...extra,
  };
}

/** A release with its early access (P-X02): 48 hours before its opening, from 10 OCT 2026 · 10:00 UTC, one time for both tiers (as published before BP-19 T3). */
const EARLY = { earlyAccessHours: 48, earlyAccessOpensAt: '2026-10-10T10:00:00.000Z' } as const;
/** BP-19 T3: PALLADIUM 4 hours before its opening (06:00 UTC), PLATINE 2 hours before (08:00 UTC). */
const BY_TIER = {
  earlyAccessHours: 4,
  earlyAccessPlatineHours: 2,
  earlyAccessOpensAt: '2026-10-12T06:00:00.000Z',
  earlyAccessPlatineOpensAt: '2026-10-12T08:00:00.000Z',
  earlyAccessPlatineOpen: false,
} as const;
/** An early access as the release's page passes it to its entry: one time for both tiers unless said. */
const early = (opensAt: string, open: boolean, platine: { opensAt?: string | null; open?: boolean } = {}): EarlyAccess => ({
  opensAt,
  open,
  platineOpensAt: platine.opensAt === undefined ? opensAt : platine.opensAt,
  platineOpen: platine.open ?? open,
  palladiumHours: 48,
  platineHours: 48,
});

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
    reserved: false,
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
    // A LIVE RELEASE's boutique board: its own route; an address that is none of a release is the list.
    expect(releasesRouteOf(`/verify/releases/${ID}/board`)).toEqual({ release: ID, board: true });
    expect(releasesRouteOf(`/verify/releases/${ID.toUpperCase()}/BOARD/`)).toEqual({ release: ID, board: true });
    expect(releasesRouteOf('/verify/releases/not-a-release/board')).toEqual({ release: null });
    expect(releasesRouteOf(`/verify/releases/${ID}/boards`)).toEqual({ release: null });
    // An after-room (plan LIVE RELEASE+): its own route, by the release it follows.
    expect(releasesRouteOf(`/verify/releases/${ID}/after-room`)).toEqual({ release: ID, afterRoom: true });
    expect(releasesRouteOf(`/verify/releases/${ID.toUpperCase()}/AFTER-ROOM/`)).toEqual({ release: ID, afterRoom: true });
    expect(releasesRouteOf('/verify/releases/not-a-release/after-room')).toEqual({ release: null });
    expect(releasesRouteOf(`/verify/releases/${ID}/after-room/x`)).toEqual({ release: null });
    expect(afterRoomPath(ID)).toBe(`/verify/releases/${ID}/after-room`);
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
      price: null,
      image: { src: media(1), alt: 'The model of MONOLITHE — RELEASE I, photographed by ORBES' },
    });
    // NOCTURNE (addition 5): a draw's price on its card, as the house writes it; none without both its amount and currency.
    expect(releaseCards([card({ priceMinor: 420000, currency: 'EUR' })])[0]!.price).toBe('€\u00a04\u00a0200');
    expect(releaseCards([card({ priceMinor: 12540000, currency: 'USD' })])[0]!.price).toBe('$\u00a0125\u00a0400');
    expect(releaseCards([card({ priceMinor: 420000, currency: null })])[0]!.price).toBeNull();
    expect(drawPrice({ priceMinor: null, currency: 'EUR' })).toBeNull();
    expect(upcoming).toMatchObject({ stateLabel: 'ENTRIES OPEN SOON', line: '3 PIECES · ENTRIES OPEN 12 OCT 2026 · 10:00 UTC' });
    expect(drawn).toMatchObject({ stateLabel: 'DRAWN', line: '1 PIECE', image: null });
    // A release without an id of its own is left out.
    expect(releaseCards([card({ id: 'nope' }), card({ title: undefined as unknown as string })])).toEqual([]);
  });

  it('gives a release\'s facts, its model\'s sheet when it is public, and its seed only once drawn', () => {
    const s = releaseSheet(sheet(), 120);
    expect(s).toMatchObject({ id: ID, title: 'MONOLITHE — RELEASE I', state: 'OPEN', stateLabel: 'ENTRIES OPEN', eyebrow: 'ORBIT 2026', model: 'MONOLITHE · RING', lookbookSlug: 'monolithe', drawn: false, seed: null, seedHex: null });
    expect(s.rows).toEqual([
      { label: 'PIECES', value: '3' },
      { label: 'ENTRIES OPEN', value: '12 OCT 2026 · 10:00 UTC', local: '12 OCT 2026 · 12:00 on this phone (UTC+02:00)' },
      { label: 'ENTRIES CLOSE', value: '14 OCT 2026 · 10:00 UTC', local: '14 OCT 2026 · 12:00 on this phone (UTC+02:00)' },
      { label: 'PLACE HELD', value: '48 HOURS' },
    ]);
    expect(s.seedHash).toBe(groupHex(HASH));
    expect(s.seedHash.split(' ')).toHaveLength(16);
    // A seed sent before the draw is not shown; once drawn it is, with the draw's time; the release is over (plan LIVE
    // RELEASE+, decision 30), and never says how many took part (no end figure, choice 5).
    expect(releaseSheet(sheet({ seed: 'cd'.repeat(32) }), 0).seed).toBeNull();
    const d = releaseSheet(sheet({ state: 'DRAWN', seed: 'cd'.repeat(32), drawnAt: '2026-10-14T12:00:00.000Z' }), 0);
    expect(d).toMatchObject({ drawn: true, stateLabel: 'THIS RELEASE IS OVER', seedHex: 'cd'.repeat(32), seed: groupHex('cd'.repeat(32)) });
    expect(d).not.toHaveProperty('entries');
    expect(RELEASES.entriesLead).not.toMatch(/\d/);
    expect(d.rows.at(-1)).toEqual({ label: 'DRAWN', value: '14 OCT 2026 · 12:00 UTC', local: null });
    // No collection: the model's name over the title; an address that is none: no link to a sheet.
    expect(releaseSheet(sheet({ model: { ...card().model, collection: null, lookbook: 'Not One' } }), 0)).toMatchObject({ eyebrow: 'MONOLITHE', lookbookSlug: null });
    expect(releaseSheet(sheet({ purchaseWindowHours: 1 }), 0).rows[3]).toEqual({ label: 'PLACE HELD', value: '1 HOUR' });
    // NOCTURNE (addition 5, C19): a draw's price first among its facts, when ORBES gave one.
    expect(releaseSheet(sheet({ priceMinor: 420000, currency: 'EUR' }), 0).rows[0]).toEqual({ label: 'PRICE', value: '€\u00a04\u00a0200' });
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
  const opts = { offsetMinutes: 120 };

  it('offers ENTER THE DRAW while entries are open, WITHDRAW until the draw, and says when entries open', () => {
    expect(entryModel(release, null, opts)).toMatchObject({ label: null, canEnter: true, canWithdraw: false, sentence: RELEASES.status.open });
    expect(entryModel({ ...release, state: 'UPCOMING' }, null, opts)).toMatchObject({ canEnter: false, sentence: 'Entries open on 12 October 2026, 12:00 (UTC+02:00).' });
    expect(entryModel({ ...release, state: 'CLOSED' }, null, opts)).toMatchObject({ canEnter: false, sentence: 'Entries are closed. The draw follows.' });
    expect(entryModel({ ...release, state: 'DRAWN' }, null, opts).sentence).toBe('The draw has taken place.');
    expect(entryModel(release, entry(), opts)).toMatchObject({ label: 'ENTERED', entryId: ENTRY, canEnter: false, canWithdraw: true, write: null });
    expect(entryModel({ ...release, state: 'CLOSED' }, entry(), opts)).toMatchObject({ canWithdraw: true, sentence: 'You are entered in the draw, which follows the close of entries.' });
    expect(entryModel(release, entry({ status: 'WITHDRAWN' }), opts)).toMatchObject({ label: 'WITHDRAWN', canEnter: true, canWithdraw: false });
    expect(entryModel({ ...release, state: 'CLOSED' }, entry({ status: 'WITHDRAWN' }), opts)).toMatchObject({ canEnter: false, sentence: 'You withdrew from this draw.' });
    expect(entryModel({ ...release, state: 'CANCELLED' }, entry(), opts)).toMatchObject({ canEnter: false, canWithdraw: false, sentence: 'This release has been cancelled: there will be no draw.' });
  });

  it('holds a place until its time, ORBES Client Services will contact the account, with WRITE TO ORBES CLIENT SERVICES; then the waiting list, the sale, the lapse', () => {
    const held = entryModel({ ...release, state: 'DRAWN' }, entry({ status: 'SELECTED', rank: 1, respondBy: '2026-10-16T12:00:00.000Z' }), opts);
    expect(held).toMatchObject({ label: 'PLACE HELD', canEnter: false, canWithdraw: false });
    expect(held.sentence).toBe('Your place is held until 16 October 2026, 14:00 (UTC+02:00) — ORBES Client Services will contact you.');
    // CS-01: the button, the release attached with the place held (its id, never an email).
    expect(held.write).toEqual({ kind: 'RELEASE', id: ID, label: 'MONOLITHE — RELEASE I · PLACE HELD' });
    // Whatever the configuration of ORBES Client Services: the button needs none.
    expect(entryModel({ ...release, state: 'DRAWN' }, entry({ status: 'SELECTED', respondBy: '2026-10-16T12:00:00.000Z' }), { offsetMinutes: 0 }).write).toEqual(held.write);
    expect(entryModel({ ...release, state: 'DRAWN' }, entry({ status: 'WAITLISTED', rank: 4 }), opts).sentence).toBe('You are on the waiting list, rank 4. ORBES Client Services will contact you if a place opens.');
    expect(entryModel({ ...release, state: 'DRAWN' }, entry({ status: 'CONFIRMED', rank: 1 }), opts)).toMatchObject({ label: 'CONCLUDED', sentence: RELEASES.status.confirmed, write: { kind: 'RELEASE', id: ID, label: 'MONOLITHE — RELEASE I · CONCLUDED' } });
    expect(entryModel({ ...release, state: 'DRAWN' }, entry({ status: 'WAITLISTED', rank: 4 }), opts).write).toBeNull();
    expect(entryModel({ ...release, state: 'DRAWN' }, entry({ status: 'LAPSED', rank: 2 }), opts)).toMatchObject({ label: 'LAPSED', sentence: RELEASES.status.lapsed });
  });

  it('offers SHARE TO STORIES (BP-10) for a place SELECTED, reserved directly or concluded only, its card SELECTED; the page\'s words unchanged', () => {
    const page = releaseSheet(sheet({ state: 'DRAWN', drawnAt: '2026-10-14T18:00:00.000Z' }), 120);
    const drawn = { ...release, state: 'DRAWN' as const };
    const held = entry({ status: 'SELECTED', rank: 1, respondBy: '2026-10-16T12:00:00.000Z', drawnAt: '2026-10-14T18:00:00.000Z' });
    expect(drawStoryModel(page, held, 120)).toEqual({ origin: 'draw', photo: media(1), status: 'SELECTED', eyebrow: 'DRAW', title: ['MONOLITHE', '— RELEASE I'], date: '14 OCTOBER 2026' });
    const reserved = entry({ status: 'SELECTED', reserved: true, enteredAt: '2026-10-10T23:30:00.000Z', respondBy: '2026-10-12T23:30:00.000Z' });
    expect(drawStoryModel(page, reserved, 120)).toMatchObject({ status: 'SELECTED', date: '11 OCTOBER 2026' });
    const concluded = entry({ status: 'CONFIRMED', rank: 1, drawnAt: '2026-10-14T18:00:00.000Z' });
    expect(drawStoryModel(page, concluded, 120)).toMatchObject({ status: 'SELECTED' });
    for (const status of ['ENTERED', 'WAITLISTED', 'LAPSED', 'WITHDRAWN'] as const) expect(drawStoryModel(page, entry({ status, drawnAt: '2026-10-14T18:00:00.000Z' }), 120), status).toBeNull();
    expect(drawStoryModel({ ...page, state: 'CANCELLED' }, held, 120)).toBeNull();
    expect(drawStoryModel({ ...page, image: null }, held, 120)).toBeNull();
    // The page's own words stay PLACE HELD, PLACE RESERVED and CONCLUDED: only the card says SELECTED.
    expect(entryModel(drawn, held, opts).label).toBe('PLACE HELD');
    expect(entryModel(drawn, reserved, opts).label).toBe('PLACE RESERVED');
    expect(entryModel(drawn, concluded, opts).label).toBe('CONCLUDED');
    expect(Object.values(RELEASES.statusLabel)).not.toContain('SELECTED');
  });

  it('groups the account\'s entries for MY PIECES, each with its release\'s page', () => {
    const list = myEntries([entry(), entry({ dropId: 'nope' }), entry({ id: ID, dropId: ID.replace('8a1d', '8a1e'), state: 'DRAWN', status: 'WAITLISTED', rank: 2 })], opts);
    expect(list.map((e) => [e.href, e.stateLabel, e.entry.label])).toEqual([
      [`/verify/releases/${ID}`, 'ENTRIES OPEN', 'ENTERED'],
      [`/verify/releases/${ID.replace('8a1d', '8a1e')}`, 'DRAWN', 'WAITING LIST'],
    ]);
  });
});

describe('the early access of a release (P-X02)', () => {
  it('says both openings under the state, the early access among the facts, EARLY ACCESS while it lasts, and EVERY PIECE RESERVED once full', () => {
    // Before the early access: its line, its time in UTC then on this phone, its paragraph; no count of places yet.
    const before = releaseSheet(sheet({ ...EARLY, state: 'UPCOMING' }), 120);
    expect(before).toMatchObject({
      stateLabel: 'ENTRIES OPEN SOON',
      access: 'PLATINE AND PALLADIUM: FROM 10 OCT 2026 · 10:00 UTC · EVERYONE: FROM 12 OCT 2026 · 10:00 UTC',
      earlyNote: RELEASES.earlyNote,
      earlyAccess: { opensAt: EARLY.earlyAccessOpensAt, open: false, platineOpensAt: EARLY.earlyAccessOpensAt },
      full: false,
    });
    expect(before.rows.map((r) => r.label)).toEqual(['PIECES', 'EARLY ACCESS', 'ENTRIES OPEN', 'ENTRIES CLOSE', 'PLACE HELD']);
    // BP-19 T3: the EARLY ACCESS fact gives each tier's hours (one time for both here); the line under the state its times.
    expect(before.rows[1]).toEqual({ label: 'EARLY ACCESS', value: 'PALLADIUM\u00a048\u00a0HOURS · PLATINE\u00a048\u00a0HOURS' });
    // During it: EARLY ACCESS, and the places reserved directly.
    const during = releaseSheet(sheet({ ...EARLY, state: 'UPCOMING', earlyAccessOpen: true, reserved: 1 }), 0);
    expect(during).toMatchObject({ stateLabel: 'EARLY ACCESS', earlyAccess: { open: true }, full: false });
    expect(during.rows.find((r) => r.label === 'RESERVED DIRECTLY')).toEqual({ label: 'RESERVED DIRECTLY', value: '1 OF 3 PIECES' });
    // Every piece reserved: said after the state until the draw, entries opened or not.
    expect(releaseSheet(sheet({ ...EARLY, state: 'UPCOMING', earlyAccessOpen: true, reserved: 3 }), 0)).toMatchObject({ stateLabel: 'EARLY ACCESS · EVERY PIECE RESERVED', full: true });
    expect(releaseSheet(sheet({ ...EARLY, state: 'OPEN', reserved: 3 }), 0)).toMatchObject({ stateLabel: 'ENTRIES OPEN · EVERY PIECE RESERVED', full: true, earlyAccess: { open: false } });
    // Full as RESERVE counts it (IN-01: the pieces the house still guarantees), the figure of the places reserved unchanged.
    const guaranteedFull = releaseSheet(sheet({ ...EARLY, state: 'UPCOMING', earlyAccessOpen: true, reserved: 2, full: true }), 0);
    expect(guaranteedFull).toMatchObject({ stateLabel: 'EARLY ACCESS · EVERY PIECE RESERVED', full: true });
    expect(guaranteedFull.rows.find((r) => r.label === 'RESERVED DIRECTLY')).toEqual({ label: 'RESERVED DIRECTLY', value: '2 OF 3 PIECES' });
    expect(releaseSheet(sheet({ ...EARLY, state: 'DRAWN', reserved: 0, full: true, seed: 'cd'.repeat(32), drawnAt: '2026-10-14T12:00:00.000Z' }), 0).full).toBe(false);
    // Drawn, the release is over: no end figure, the places reserved directly no longer counted.
    const drawn = releaseSheet(sheet({ ...EARLY, state: 'DRAWN', reserved: 3, seed: 'cd'.repeat(32), drawnAt: '2026-10-14T12:00:00.000Z' }), 0);
    expect(drawn).toMatchObject({ stateLabel: 'THIS RELEASE IS OVER', full: false });
    expect(drawn.rows.map((r) => r.label)).toEqual(['PIECES', 'EARLY ACCESS', 'ENTRIES OPEN', 'ENTRIES CLOSE', 'PLACE HELD', 'DRAWN']);
    // A server that says the early access is open after the opening is not believed; one piece says PIECE.
    expect(releaseSheet(sheet({ ...EARLY, state: 'OPEN', earlyAccessOpen: true, reserved: 0, quantity: 1 }), 0)).toMatchObject({ stateLabel: 'ENTRIES OPEN', earlyAccess: { open: false } });
    expect(releaseSheet(sheet({ ...EARLY, state: 'OPEN', quantity: 1 }), 0).rows.find((r) => r.label === 'RESERVED DIRECTLY')?.value).toBe('0 OF 1 PIECE');
    // Without an early access (0 hours, or a release published once open), or a time that is none: no line, no fact.
    for (const s of [sheet(), sheet({ earlyAccessHours: 48, earlyAccessOpensAt: 'nonsense' })]) {
      const m = releaseSheet(s, 0);
      expect(m).toMatchObject({ access: null, earlyNote: null, earlyAccess: null });
      expect(m.rows.map((r) => r.label)).not.toContain('EARLY ACCESS');
    }
    // The list: EARLY ACCESS while it lasts, the time of the opening as before.
    const [early, soon] = releaseCards([card({ ...EARLY, state: 'UPCOMING', earlyAccessOpen: true }), card({ ...EARLY, id: ID.replace('8a1d', '8a1e'), state: 'UPCOMING' })]);
    expect(early).toMatchObject({ stateLabel: 'EARLY ACCESS', state: 'UPCOMING', line: '3 PIECES · ENTRIES OPEN 12 OCT 2026 · 10:00 UTC' });
    expect(soon).toMatchObject({ stateLabel: 'ENTRIES OPEN SOON' });
  });

  it('says each tier\'s time when they differ (BP-19 T3): PALLADIUM, then PLATINE, then everyone; each tier\'s hours among the facts; PALLADIUM owners, then PLATINE owners, in the paragraph', () => {
    const before = releaseSheet(sheet({ ...BY_TIER, state: 'UPCOMING' }), 120);
    expect(before).toMatchObject({
      stateLabel: 'ENTRIES OPEN SOON',
      access: 'PALLADIUM: FROM 12 OCT 2026 · 06:00 UTC · PLATINE: FROM 12 OCT 2026 · 08:00 UTC · EVERYONE: FROM 12 OCT 2026 · 10:00 UTC',
      earlyNote: RELEASES.earlyNoteByTier,
      earlyAccess: { opensAt: BY_TIER.earlyAccessOpensAt, open: false, platineOpensAt: BY_TIER.earlyAccessPlatineOpensAt, platineOpen: false },
    });
    expect(before.rows.find((r) => r.label === 'EARLY ACCESS')).toEqual({ label: 'EARLY ACCESS', value: 'PALLADIUM\u00a04\u00a0HOURS · PLATINE\u00a02\u00a0HOURS' });
    // Each tier's words hold together: a narrow phone wraps the row only at ' · ', never between a figure and its unit.
    expect(before.rows.find((r) => r.label === 'EARLY ACCESS')!.value.split(' · ').map((g) => g.includes(' '))).toEqual([false, false]);
    expect(RELEASES.earlyNoteByTier).toBe(
      'Before entries open to everyone, PALLADIUM owners, then PLATINE owners, reserve a place directly, first come, first served, within the pieces of the release: their tier is the one their account holds when they reserve. The pieces left then go to the draw.',
    );
    // During PALLADIUM's hours: EARLY ACCESS already.
    expect(releaseSheet(sheet({ ...BY_TIER, state: 'UPCOMING', earlyAccessOpen: true }), 0)).toMatchObject({ stateLabel: 'EARLY ACCESS', earlyAccess: { open: true, platineOpen: false } });
    // PLATINE without a window of its own: only PALLADIUM's time, and its hours.
    const palladiumOnly = releaseSheet(sheet({ ...BY_TIER, earlyAccessPlatineHours: 0, earlyAccessPlatineOpensAt: null, state: 'UPCOMING' }), 0);
    expect(palladiumOnly.access).toBe('PALLADIUM: FROM 12 OCT 2026 · 06:00 UTC · EVERYONE: FROM 12 OCT 2026 · 10:00 UTC');
    expect(palladiumOnly.rows.find((r) => r.label === 'EARLY ACCESS')?.value).toBe('PALLADIUM\u00a04\u00a0HOURS');
    // Two equal times: the release keeps the one line of before.
    const alike = releaseSheet(sheet({ ...BY_TIER, earlyAccessPlatineHours: 4, earlyAccessPlatineOpensAt: BY_TIER.earlyAccessOpensAt, state: 'UPCOMING' }), 0);
    expect(alike).toMatchObject({ access: 'PLATINE AND PALLADIUM: FROM 12 OCT 2026 · 06:00 UTC · EVERYONE: FROM 12 OCT 2026 · 10:00 UTC', earlyNote: RELEASES.earlyNote });
  });

  it('tells each tier its own time (BP-19 T3): PALLADIUM reserves from its hours, PLATINE is told when its own begin, the others wait', () => {
    const opts = { offsetMinutes: 120 };
    const opens = '12 October 2026, 12:00 (UTC+02:00)';
    const platineFrom = '12 October 2026, 10:00 (UTC+02:00)';
    const base = { id: ID, title: 'MONOLITHE — RELEASE I', state: 'UPCOMING' as const, opensAt: '2026-10-12T10:00:00.000Z', full: false };
    // Before any window: each tier its own time.
    const soon = { ...base, earlyAccess: early(BY_TIER.earlyAccessOpensAt, false, { opensAt: BY_TIER.earlyAccessPlatineOpensAt, open: false }) };
    expect(entryModel(soon, null, { ...opts, tier: 3 }).sentence).toBe(RELEASES.status.earlySoon('PALLADIUM', '12 October 2026, 08:00 (UTC+02:00)'));
    expect(entryModel(soon, null, { ...opts, tier: 2 }).sentence).toBe(RELEASES.status.earlySoon('PLATINE', platineFrom));
    // PALLADIUM's hours: PALLADIUM reserves; PLATINE is told when; the others read that PALLADIUM owners reserve.
    const palladium = { ...base, earlyAccess: early(BY_TIER.earlyAccessOpensAt, true, { opensAt: BY_TIER.earlyAccessPlatineOpensAt, open: false }) };
    expect(entryModel(palladium, null, { ...opts, tier: 3 })).toMatchObject({ canReserve: true, sentence: RELEASES.status.early('PALLADIUM', opens) });
    expect(entryModel(palladium, null, { ...opts, tier: 2 })).toMatchObject({ canReserve: false, sentence: RELEASES.status.earlyPalladium(platineFrom) });
    expect(RELEASES.status.earlyPalladium(platineFrom)).toBe(`PALLADIUM owners are reserving their places now. As a PLATINE owner, you may reserve a place from ${platineFrom}.`);
    for (const tier of [1, 0, undefined]) {
      expect(entryModel(palladium, null, { ...opts, tier }), String(tier)).toMatchObject({ canReserve: false, sentence: RELEASES.status.earlyOthersPalladium(opens) });
    }
    expect(RELEASES.status.earlyOthersPalladium(opens)).toBe(`PALLADIUM owners are reserving their places now. Entries open to everyone on ${opens}.`);
    // PLATINE's hours: both reserve, the others read the sentence of before.
    const both = { ...base, earlyAccess: early(BY_TIER.earlyAccessOpensAt, true, { opensAt: BY_TIER.earlyAccessPlatineOpensAt, open: true }) };
    expect(entryModel(both, null, { ...opts, tier: 2 })).toMatchObject({ canReserve: true, sentence: RELEASES.status.early('PLATINE', opens) });
    expect(entryModel(both, null, { ...opts, tier: 1 }).sentence).toBe(RELEASES.status.earlyOthers(opens));
    // PLATINE without a window of its own: it waits with the others.
    const none = { ...base, earlyAccess: early(BY_TIER.earlyAccessOpensAt, true, { opensAt: null, open: false }) };
    expect(entryModel(none, null, { ...opts, tier: 2 })).toMatchObject({ canReserve: false, sentence: RELEASES.status.earlyOthersPalladium(opens) });
    // The page passes the server's fields as they are.
    expect(earlyAccessOf({ ...card({ ...BY_TIER, state: 'UPCOMING', earlyAccessOpen: true, earlyAccessPlatineOpen: true }) })).toMatchObject({ open: true, platineOpen: true, palladiumHours: 4, platineHours: 2 });
  });

  it('offers RESERVE A PLACE to a PLATINE or PALLADIUM account during the early access only, while a piece is left', () => {
    const release = { id: ID, title: 'MONOLITHE — RELEASE I', state: 'UPCOMING' as const, opensAt: '2026-10-12T10:00:00.000Z', earlyAccess: early(EARLY.earlyAccessOpensAt, true), full: false };
    const opts = { offsetMinutes: 120 };
    const opens = '12 October 2026, 12:00 (UTC+02:00)';
    expect(entryModel(release, null, { ...opts, tier: 2 })).toMatchObject({ canReserve: true, canEnter: false, sentence: RELEASES.status.early('PLATINE', opens) });
    expect(entryModel(release, null, { ...opts, tier: 3 })).toMatchObject({ canReserve: true, sentence: RELEASES.status.early('PALLADIUM', opens) });
    expect(RELEASES.status.early('PLATINE', opens)).toBe(`As a PLATINE owner, you may reserve a place now, until entries open to everyone on ${opens}. First come, first served, within the pieces of the release.`);
    // A TITANE account, an account without a piece or whose tier is unknown: it waits for the opening.
    for (const tier of [1, 0, undefined]) {
      expect(entryModel(release, null, { ...opts, tier }), String(tier)).toMatchObject({ canReserve: false, canEnter: false, sentence: RELEASES.status.earlyOthers(opens) });
    }
    // Every piece reserved: nothing to reserve, the waiting list of the draw after the opening.
    expect(entryModel({ ...release, full: true }, null, { ...opts, tier: 3 })).toMatchObject({ canReserve: false, sentence: RELEASES.status.full(opens) });
    expect(entryModel({ ...release, state: 'OPEN', earlyAccess: early(EARLY.earlyAccessOpensAt, false), full: true }, null, { ...opts, tier: 3 })).toMatchObject({ canEnter: true, canReserve: false, sentence: RELEASES.status.openFull });
    // Before the early access: a PLATINE account is told when it may reserve, any other when entries open.
    const soon = { ...release, earlyAccess: early(EARLY.earlyAccessOpensAt, false) };
    expect(entryModel(soon, null, { ...opts, tier: 2 })).toMatchObject({ canReserve: false, sentence: RELEASES.status.earlySoon('PLATINE', '10 October 2026, 12:00 (UTC+02:00)') });
    expect(entryModel(soon, null, { ...opts, tier: 1 })).toMatchObject({ canReserve: false, sentence: RELEASES.status.upcoming(opens) });
    // Once entries are open, RESERVE A PLACE is gone: ENTER THE DRAW, for everyone.
    expect(entryModel({ ...soon, state: 'OPEN' }, null, { ...opts, tier: 3 })).toMatchObject({ canReserve: false, canEnter: true, sentence: RELEASES.status.open });

    // The place reserved: PLACE RESERVED until its time, WRITE TO ORBES CLIENT SERVICES (CS-01); no WITHDRAW.
    const mine = entry({ state: 'UPCOMING', status: 'SELECTED', reserved: true, respondBy: '2026-10-12T09:00:00.000Z' });
    const held = entryModel(release, mine, { ...opts, tier: 2 });
    expect(held).toMatchObject({ label: 'PLACE RESERVED', canReserve: false, canEnter: false, canWithdraw: false, entryId: ENTRY });
    expect(held.sentence).toBe('You reserved a place directly. It is held until 12 October 2026, 11:00 (UTC+02:00) — ORBES Client Services will contact you.');
    expect(held.write).toEqual({ kind: 'RELEASE', id: ID, label: 'MONOLITHE — RELEASE I · PLACE RESERVED' });
    // Concluded or lapsed, as a place drawn; MY PIECES names it so.
    expect(entryModel(release, { ...mine, status: 'CONFIRMED' }, opts)).toMatchObject({ label: 'CONCLUDED', sentence: RELEASES.status.confirmed });
    expect(myEntries([mine], opts).map((e) => [e.stateLabel, e.entry.label])).toEqual([['ENTRIES OPEN SOON', 'PLACE RESERVED']]);
  });
});

describe('THE RELEASES\' PAST (plan LIVE RELEASE+, choice 5)', () => {
  const DRAW = '5c2e7a10-3b4d-4e6f-8a9b-1c2d3e4f5a6b';
  const past = (extra: Partial<PastRelease> = {}): PastRelease => ({
    id: ID,
    kind: 'LIVE',
    title: 'Monolithe — live',
    model: { name: 'Monolithe', type: 'Ring', collection: 'Orbit 2026' },
    imageUrl: media(1),
    opensAt: '2026-10-11T17:00:00.000Z',
    quantityLine: '25 pieces',
    ...extra,
  });

  it('shows each release ended as announced: LIVE RELEASE or DRAW, its name, its opening date on this phone, its quantity line; no end figure', () => {
    const [live, draw] = pastCards(
      [past(), past({ id: DRAW, kind: 'DRAW', title: 'Eclipse — release I', model: { name: 'Eclipse', type: 'Pendant', collection: null }, imageUrl: null, opensAt: '2026-09-01T10:00:00.000Z', quantityLine: '3 PIECES' })],
      'Europe/Paris',
    );
    // A LIVE RELEASE named by its model (with its variant: NOCTURNE, C25), as its card and page; a draw by its title, as
    // its card. Its date after its kind, its quantity apart (C25).
    expect(live).toEqual({
      id: ID,
      href: `/verify/releases/${ID}`,
      kind: 'LIVE RELEASE',
      title: 'MONOLITHE',
      model: 'RING · ORBIT 2026',
      line: '11 OCT 2026 · 25 PIECES',
      date: '11 OCT 2026',
      pieces: '25 PIECES',
      image: { src: media(1), alt: 'The model of MONOLITHE, photographed by ORBES' },
    });
    expect(pastCards([past({ model: { name: 'Monolithe', type: 'Ring', collection: 'Orbit 2026', variant: 'Steel' } })], 'UTC')[0]).toMatchObject({ title: 'MONOLITHE IN STEEL' });
    expect(draw).toEqual({ id: DRAW, href: `/verify/releases/${DRAW}`, kind: 'DRAW', title: 'ECLIPSE — RELEASE I', model: 'ECLIPSE · PENDANT', line: '1 SEP 2026 · 3 PIECES', date: '1 SEP 2026', pieces: '3 PIECES', image: null });
    // Ended before its name was revealed: LIVE RELEASE, nothing more; a photograph from the media route only.
    expect(pastCards([past({ title: null, model: { name: null, type: null, collection: null }, imageUrl: 'https://elsewhere.example/x.jpg' })], 'UTC')[0]).toMatchObject({ title: 'LIVE RELEASE', model: '', image: null });
    // Not a release: left out.
    expect(pastCards([past({ id: 'nope' }), past({ kind: 'SALON' as 'LIVE' })], 'UTC')).toEqual([]);
  });

  it('reads PAST a page at a time by the page counted: a release ended between two pages, or one unreadable, never keeps SHOW MORE from the last release', () => {
    const idOf = (n: number) => `${n.toString(16).padStart(8, '0')}-4b2e-4f3a-9c1d-0e5f6a7b8c9d`;
    // The server's PAST: 25 releases, the newest first; a page of PAST_PAGE_SIZE.
    let server = Array.from({ length: 25 }, (_, i) => past({ id: idOf(100 - i) }));
    const read = (pages: PastPages) => {
      const page = pages.next;
      const items = server.slice((page - 1) * PAST_PAGE_SIZE, page * PAST_PAGE_SIZE);
      return pages.add(page, pastCards(items, 'UTC'), server.length);
    };
    const pages = new PastPages();
    expect([pages.next, pages.more]).toEqual([1, false]);
    expect(read(pages)).toHaveLength(PAST_PAGE_SIZE);
    expect([pages.next, pages.more]).toEqual([2, true]);
    // A release ends while the first page is on screen: the others move down one, the second page brings one already shown.
    server = [past({ id: idOf(200) }), ...server];
    const second = read(pages);
    expect(second).toHaveLength(PAST_PAGE_SIZE - 1);
    expect(second.map((c) => c.id)).not.toContain(idOf(100 - (PAST_PAGE_SIZE - 1)));
    // SHOW MORE asks for the third page, never the second again, and reaches the last release; then it is gone.
    expect([pages.cards.length, pages.next, pages.more]).toEqual([2 * PAST_PAGE_SIZE - 1, 3, true]);
    expect(read(pages).map((c) => c.id)).toEqual([idOf(100 - 23), idOf(100 - 24)]);
    expect(pages.cards.map((c) => c.id)).toEqual(Array.from({ length: 25 }, (_, i) => idOf(100 - i)));
    expect([pages.next, pages.more]).toEqual([4, false]);
    // A release unreadable is left out, the next page still counted.
    const odd = new PastPages();
    expect(odd.add(1, pastCards([past({ id: 'nope' }), past()], 'UTC'), 13)).toHaveLength(1);
    expect([odd.next, odd.more]).toEqual([2, true]);
    // Nothing ended: no SHOW MORE.
    const none = new PastPages();
    none.add(1, [], 0);
    expect(none.more).toBe(false);
  });

  it('dates a release on this phone\'s calendar', () => {
    expect(zonedDate('2026-10-11T23:30:00.000Z', 'Europe/Paris')).toBe('12 OCT 2026');
    expect(zonedDate('2026-10-11T23:30:00.000Z', 'America/New_York')).toBe('11 OCT 2026');
    expect(zonedDate('2026-09-01T10:00:00.000Z', 'Not/AZone')).toBe('1 SEP 2026');
    expect(zonedDate('nonsense', 'UTC')).toBe('');
  });

  it('says how many releases the account took part in, and on each YOU SECURED A PIECE or YOU TOOK PART', () => {
    const m = participationModel({ count: 3, releases: [{ id: ID, secured: true }, { id: DRAW, secured: false }, { id: 'nope', secured: true }] });
    expect(m.taken).toBe('You have taken part in 3 releases.');
    expect([...m.marks]).toEqual([
      [ID, 'YOU SECURED A PIECE'],
      [DRAW, 'YOU TOOK PART'],
    ]);
    expect(participationModel({ count: 1, releases: [{ id: ID, secured: false }] }).taken).toBe('You have taken part in 1 release.');
    expect(participationModel({ count: 0, releases: [] }).taken).toBe('You have taken part in 0 releases.');
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
    // P-X02: the plan's line, word for word, and the action of the early access.
    expect(RELEASES.access('…', '…')).toBe('PLATINE AND PALLADIUM: FROM … · EVERYONE: FROM …');
    // BP-19 T3: the line by tier, word for word; the rule's tier wording unchanged and free of the tiers' figures.
    expect(RELEASES.accessByTier('a', 'b', 'c')).toBe('PALLADIUM: FROM a · PLATINE: FROM b · EVERYONE: FROM c');
    expect(RELEASES.rule).toContain('The entries are ranked by tier, from PALLADIUM to PLATINE to TITANE, then the accounts that hold no piece;');
    expect(RELEASES.rule).not.toMatch(/\b\d+ (?:pieces?|hours?)\b/i);
    expect(RELEASES.reserve).toBe('RESERVE A PLACE');
    expect(RELEASES.status.selected('16 October 2026, 14:00 (UTC+02:00)')).toBe('Your place is held until 16 October 2026, 14:00 (UTC+02:00) — ORBES Client Services will contact you.');
    // The server's 404 says what the page says.
    expect(dropNotFound().publicMessage).toBe(RELEASES.notFound);
    expect(dropNotFound()).toMatchObject({ code: 'DROP_NOT_FOUND', httpStatus: 404 });
  });

  it('states the rule the server applies: the tier, the seniority, then SHA-256 of the seed and the entry\'s id in lower case', () => {
    for (const s of ['PALLADIUM', 'PLATINE', 'TITANE', 'seniority', 'SHA-256 of the 32 bytes of the seed', 'lower-case', 'increasing hexadecimal order', 'moment of the draw', 'waiting list', 'pieces left after the direct reservations']) {
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
