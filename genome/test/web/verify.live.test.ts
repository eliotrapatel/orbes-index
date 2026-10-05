/**
 * The LIVE RELEASE as /verify shows it (plan of 2026-10-04; src/web/verify/live-model.ts, live-seal.ts): which screen
 * the page shows from the release, the account's standing, the room and its entry; the server's clock from three round
 * trips; the times in Paris then on this phone; the prices as the house writes them; the countdowns; the lock's orbits
 * in the last minute and its ten ticks; the size picker (the size of I'LL BE THERE preselected); the line's facts; the
 * add-ons; the card in THE RELEASES (each stage only once the server sends it, the seal before any); MY PIECES; the
 * specimen of the seal (never a piece's code); the vault palette's contrast, computed from brand.css. Pure: no DOM. The
 * pages are driven in Chromium by verify.live.e2e.test.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CODE01, CODE01_RINGS } from '../../src/core/code/profile.js';
import { unframeCodeData } from '../../src/core/payload.js';
import { LIVE } from '../../src/web/verify/copy.js';
import {
  addonChoices,
  CHANGE_RETRY_MS,
  clockOffset,
  clockText,
  countdown,
  doorOpen,
  formatMoney,
  heldEntry,
  initialSize,
  isEndedSheet,
  lineFacts,
  bannerModel,
  interestLine,
  liveCards,
  liveReference,
  measureClock,
  nextChange,
  revealCalendar,
  liveScreen,
  liveSheetModel,
  livePastModel,
  lockAngle,
  LOCK_MS,
  mediaSrc,
  myLiveEntries,
  phaseAt,
  pictureOf,
  placeAnnouncement,
  readyChecks,
  releaseTime,
  servable,
  sizeChoices,
  tickSecond,
  windowLeft,
  zonedTime,
  type LiveScreenInput,
} from '../../src/web/verify/live-model.js';
import { SEAL_RINGS, SPECIMEN_GLYPHS, specimenData } from '../../src/web/verify/live-seal.js';
import type { LiveAccountEntry, LiveCard, LiveEndedSheet, LiveEntry, LiveRoom, LiveSheet } from '../../src/web/verify/types.js';

const ID = '8a1d0c55-4b2e-4f3a-9c1d-0e5f6a7b8c9d';
const ENTRY = '01edcb93-7b6d-4e5f-8a9b-0c1d2e3f4a5b';
const S48 = '11111111-1111-4111-8111-111111111111';
const S52 = '22222222-2222-4222-8222-222222222222';
const S56 = '33333333-3333-4333-8333-333333333333';
const media = (n: number) => `/api/v1/media/${n.toString(16).padStart(2, '0').repeat(32)}`;
/** T0: Sunday 11 October 2026, 19:00 in Paris (17:00 UTC). */
const T0 = Date.parse('2026-10-11T17:00:00.000Z');
const iso = (t: number) => new Date(t).toISOString();

function card(extra: Partial<LiveCard> = {}): LiveCard {
  return {
    id: ID,
    kind: 'LIVE',
    phase: 'ANNOUNCED',
    revealed: { silhouette: true, name: true, photo: true },
    stages: { silhouetteAt: iso(T0 - 86_400_000), nameAt: iso(T0 - 43_200_000), photoAt: iso(T0 - 3_600_000) },
    reveals: [],
    title: 'Monolithe — live',
    name: 'Monolithe',
    type: 'Ring',
    collection: 'Orbit',
    silhouetteUrl: media(2),
    imageUrl: media(1),
    lookbook: null,
    announcedAt: iso(T0 - 7 * 86_400_000),
    roomOpensAt: iso(T0 - 300_000),
    opensAt: iso(T0),
    closesAt: iso(T0 + 3_600_000),
    priceMinor: 480_000,
    currency: 'EUR',
    quantityLine: '25 pieces',
    perAccount: 1,
    access: { minTier: 2, text: 'owners from PLATINE' },
    surprise: false,
    interest: 0,
    ...extra,
  };
}

function sheet(extra: Partial<LiveSheet> = {}): LiveSheet {
  return {
    ...card(),
    description: 'A ring cut from one block of silver.',
    sizes: [
      { id: S48, label: '48', stock: 3 },
      { id: S52, label: '52', stock: 2 },
      { id: S56, label: '56', stock: 0 },
    ],
    addons: [
      { id: 'a1', label: 'Engraving', line: ' Your initials ', priceMinor: 15_000 },
      { id: 'a2', label: 'Gift box', line: null, priceMinor: 9_000 },
    ],
    interest: 0,
    roomOpensMinutes: 5,
    turnSeconds: 30,
    payMinutes: 5,
    tierPriority: true,
    ...extra,
  };
}

function room(extra: Partial<LiveRoom> = {}): LiveRoom {
  return {
    id: ID,
    phase: 'ROOM',
    paused: false,
    over: false,
    endedReason: null,
    roomOpensAt: iso(T0 - 300_000),
    opensAt: iso(T0),
    closesAt: iso(T0 + 3_600_000),
    inRoom: 214,
    line: 0,
    quantity: 5,
    quantityLine: '25 PIECES',
    left: 5,
    held: 0,
    sizes: [
      { id: S48, label: '48', stock: 3, left: 3, held: 0 },
      { id: S52, label: '52', stock: 2, left: 2, held: 0 },
      { id: S56, label: '56', stock: 0, left: 0, held: 0 },
    ],
    message: null,
    ...extra,
  };
}

function entry(extra: Partial<LiveEntry> = {}): LiveEntry {
  return {
    id: ENTRY,
    dropId: ID,
    status: 'WAITING',
    size: { id: S52, label: '52' },
    quantity: 1,
    tier: 2,
    position: null,
    ahead: null,
    joinedAt: iso(T0 - 120_000),
    turn: null,
    hold: null,
    confirmedAt: null,
    endedAt: null,
    letIn: false,
    addons: [],
    currency: 'EUR',
    priceMinor: 480_000,
    totalMinor: 480_000,
    ...extra,
  };
}

/** A release over, in its final state (plan LIVE RELEASE+, decision 30): what was announced, never an end figure. */
function over(extra: Partial<LiveEndedSheet> = {}): LiveEndedSheet {
  return {
    id: ID,
    kind: 'LIVE',
    phase: 'ENDED',
    title: 'Monolithe — live',
    name: 'Monolithe',
    type: 'Ring',
    collection: 'Orbit',
    description: ' A ring cut from one block of silver. ',
    silhouetteUrl: media(2),
    imageUrl: media(1),
    lookbook: 'monolithe',
    opensAt: iso(T0),
    quantityLine: '25 pieces',
    ...extra,
  };
}

const screen = (i: Partial<LiveScreenInput>) => liveScreen({ sheet: sheet(), viewer: 'ready', room: room(), entry: null, now: T0 - 60_000, ...i });

describe('the LIVE RELEASE\'s words and figures', () => {
  it('writes a price as the house does, its groups kept together', () => {
    expect(formatMoney(480_000, 'EUR')).toBe('€ 4 800');
    expect(formatMoney(505_000, 'EUR')).toBe('€ 5 050');
    expect(formatMoney(1_234_567_850, 'EUR')).toBe('€ 12 345 678.50');
    expect(formatMoney(9_000, 'GBP')).toBe('£ 90');
    expect(formatMoney(9_000, 'SEK')).toBe('SEK 90');
    expect(formatMoney(-5, 'nonsense')).toBe('€ 0');
  });

  it('says a time in Paris, then on this phone when its zone says it otherwise', () => {
    expect(zonedTime(T0, 'Europe/Paris')).toEqual({ day: 'SUNDAY 11 OCTOBER', date: '11 OCTOBER', time: '19:00', clock: '19:00:00' });
    expect(releaseTime(iso(T0), 'Europe/Paris')).toEqual({ paris: 'SUNDAY 11 OCTOBER · 19:00 PARIS', local: null });
    // Berlin keeps Paris's hour: said once.
    expect(releaseTime(iso(T0), 'Europe/Berlin').local).toBeNull();
    expect(releaseTime(iso(T0), 'America/New_York')).toEqual({ paris: 'SUNDAY 11 OCTOBER · 19:00 PARIS', local: 'SUNDAY 11 OCTOBER · 13:00 ON THIS PHONE' });
    expect(releaseTime(iso(T0), 'Asia/Tokyo').local).toBe('MONDAY 12 OCTOBER · 02:00 ON THIS PHONE');
    expect(releaseTime('nonsense', 'Europe/Paris')).toEqual({ paris: '', local: null });
    // A zone this browser does not know: UTC.
    expect(zonedTime(T0, 'Not/AZone')?.time).toBe('17:00');
  });

  it('counts down in two-digit groups: days, hours and minutes a day ahead; hours, minutes and seconds within it', () => {
    expect(countdown(2 * 3_600_000 + 14 * 60_000 + 9_000)).toEqual([
      { value: '02', unit: 'HOURS' },
      { value: '14', unit: 'MINUTES' },
      { value: '09', unit: 'SECONDS' },
    ]);
    // A partial second counts as a whole one: the countdown reads 00:00:00 at T0, not a second before.
    expect(countdown(8_001).map((p) => p.value)).toEqual(['00', '00', '09']);
    expect(countdown(3 * 86_400_000 + 5 * 3_600_000 + 61_000).map((p) => `${p.value} ${p.unit}`)).toEqual(['03 DAYS', '05 HOURS', '01 MINUTES']);
    expect(countdown(-5).map((p) => p.value)).toEqual(['00', '00', '00']);
    expect(clockText(299_001)).toBe('05:00');
    expect(clockText(24_000)).toBe('00:24');
    expect(clockText(3_904_000)).toBe('1:05:04');
    expect(clockText(-1)).toBe('00:00');
  });

  it('gives a confirmed entry its reference for ORBES Client Services', () => {
    expect(liveReference(ENTRY)).toBe('LR-01EDCB93');
  });

  it('takes a picture from this origin\'s media route only', () => {
    expect(mediaSrc(media(1))).toBe(media(1));
    expect(mediaSrc('https://elsewhere.example/x.jpg')).toBeNull();
    expect(mediaSrc(null)).toBeNull();
  });
});

describe('the server\'s clock (three round trips)', () => {
  it('keeps the offset of the shortest round trip, the server having read its clock half-way through it', () => {
    const samples = [
      { sentAt: 1_000, receivedAt: 1_300, server: 5_400 },
      { sentAt: 2_000, receivedAt: 2_040, server: 6_120 },
      { sentAt: 3_000, receivedAt: 3_100, server: 7_000 },
    ];
    expect(clockOffset(samples)).toEqual({ offset: 4_100, rtt: 40 });
    expect(clockOffset([])).toBeNull();
    expect(clockOffset([{ sentAt: 10, receivedAt: 5, server: 1 }, { sentAt: 0, receivedAt: 10, server: Number.NaN }])).toBeNull();
  });
});

describe('which screen the page shows', () => {
  it('announced, whoever reads it; then, from the room\'s opening, the sign-in, the rule, or the room', () => {
    const early = T0 - 3_600_000;
    for (const viewer of ['unknown', 'signed-out', 'not-eligible', 'ready'] as const) expect(screen({ viewer, room: null, now: early })).toBe('announced');
    expect(screen({ viewer: 'unknown' })).toBe('loading');
    expect(screen({ viewer: 'signed-out' })).toBe('signin');
    expect(screen({ viewer: 'not-eligible' })).toBe('notEligible');
    expect(screen({})).toBe('room');
    // After T0 an account not in the line chooses its size and joins behind.
    expect(screen({ now: T0 + 1_000 })).toBe('join');
    // Ended (sold out, closed, ended by ORBES), or past its close: its final state (plan LIVE RELEASE+, decision 30),
    // for whoever reads it; an after-room's, that it is closed.
    expect(screen({ room: room({ phase: 'ENDED' }), now: T0 + 1_000 })).toBe('past');
    expect(screen({ room: null, now: T0 + 3_600_000 })).toBe('past');
    for (const viewer of ['signed-out', 'not-eligible', 'ready'] as const) expect(screen({ sheet: over(), viewer })).toBe('past');
    expect(screen({ sheet: over(), viewer: 'unknown' })).toBe('loading');
    expect(screen({ sheet: sheet({ afterRoom: { parentId: ID } }), room: null, now: T0 + 3_600_000 })).toBe('over');
    expect(screen({ sheet: over({ afterRoom: { parentId: ID } }), viewer: 'signed-out' })).toBe('over');
  });

  it('follows the account\'s entry: the room, the line, the turn, the piece held, confirmed, and every edge page', () => {
    expect(screen({ entry: entry() })).toBe('room');
    expect(screen({ entry: entry({ status: 'QUEUED', position: 4, ahead: 1 }), now: T0 + 5_000 })).toBe('line');
    expect(screen({ entry: entry({ status: 'TURN' }) })).toBe('turn');
    expect(screen({ entry: entry({ status: 'SECURED' }) })).toBe('secured');
    expect(screen({ entry: entry({ status: 'CONFIRMED' }) })).toBe('confirmed');
    for (const [status, kind] of [['MISSED', 'missed'], ['EXPIRED', 'expired'], ['RELEASED', 'released'], ['REMOVED', 'removed'], ['ENDED', 'ended']] as const) {
      expect(screen({ entry: entry({ status, position: 3 }) }), status).toBe(kind);
    }
    // LEFT before T0 (no place): it may enter again, the room shows; after T0 (a place), it has left the line.
    expect(screen({ entry: entry({ status: 'LEFT' }) })).toBe('room');
    expect(heldEntry(entry({ status: 'LEFT' }))).toBeNull();
    expect(screen({ entry: entry({ status: 'LEFT', position: 9 }), now: T0 + 5_000 })).toBe('left');
    // Over, the page opens in its final state, whatever became of the entry (its part said there, never how it ended); an
    // after-room's guest keeps its outcome. Only a ready account's entry counts.
    for (const status of ['CONFIRMED', 'MISSED', 'EXPIRED', 'RELEASED', 'REMOVED', 'ENDED'] as const) expect(screen({ sheet: over(), entry: entry({ status, position: 3 }) }), status).toBe('past');
    expect(screen({ sheet: over({ afterRoom: { parentId: ID } }), entry: entry({ status: 'CONFIRMED' }) })).toBe('confirmed');
    expect(screen({ viewer: 'signed-out', entry: entry({ status: 'CONFIRMED' }) })).toBe('signin');
  });

  it('says sold out in your size only when no piece is free nor held that may return', () => {
    const queued = entry({ status: 'QUEUED', position: 4, ahead: 1 });
    const now = T0 + 5_000;
    const sizes = (left: number, held: number) => room({ phase: 'LIVE', sizes: [{ id: S52, label: '52', stock: 2, left, held }] });
    expect(screen({ entry: queued, room: sizes(0, 2), now })).toBe('line');
    expect(screen({ entry: queued, room: sizes(0, 0), now })).toBe('soldOut');
    expect(screen({ entry: entry({ ...queued, quantity: 2 }), room: sizes(1, 0), now })).toBe('soldOut');
    expect(phaseAt(sheet(), null, T0 - 400_000)).toBe('ANNOUNCED');
    expect(phaseAt(sheet(), room({ opensAt: iso(T0 + 60_000) }), T0 + 1_000)).toBe('ROOM');
    expect(isEndedSheet(sheet())).toBe(false);
  });

  it('shows the second door to a guest of the after-room from its T0 until it closes, read from its own entry; nothing of it otherwise', () => {
    const now = T0 + 20 * 60_000;
    const door = (opensIn: number, closesIn = 10 * 60_000) => ({ opensAt: iso(now + opensIn), closesAt: iso(now + closesIn) });
    const ended = (afterRoom: ReturnType<typeof door> | null) => entry({ status: 'ENDED', position: 3, afterRoom });
    expect(screen({ entry: ended(door(-60_000)), now })).toBe('afterRoom');
    expect(screen({ entry: ended(door(0)), now })).toBe('afterRoom');
    // Before its T0, after its close, or without one: how the release ended.
    expect(screen({ entry: ended(door(1_000)), now })).toBe('ended');
    expect(screen({ entry: ended(door(-60_000, 0)), now })).toBe('ended');
    expect(screen({ entry: ended(null), now })).toBe('ended');
    expect(screen({ entry: entry({ status: 'ENDED', position: 3 }), now })).toBe('ended');
    // The release over: its guest keeps the second door until it closes, then reads the release's final state.
    expect(screen({ sheet: over(), entry: ended(door(1_000)), now })).toBe('ended');
    expect(screen({ sheet: over(), entry: ended(door(-60_000)), now })).toBe('afterRoom');
    expect(screen({ sheet: over(), entry: ended(door(-60_000, 0)), now })).toBe('past');
    expect(screen({ sheet: over(), entry: ended(null), now })).toBe('past');
    // Only an entry the sell-out ENDED is a guest's: every other keeps its own page.
    for (const status of ['CONFIRMED', 'MISSED', 'EXPIRED', 'RELEASED', 'REMOVED'] as const) expect(screen({ entry: entry({ status, position: 2, afterRoom: door(-60_000) }), now })).not.toBe('afterRoom');
    expect(doorOpen(door(-1), now)).toBe(true);
    expect(doorOpen({ opensAt: 'x', closesAt: 'nonsense' }, now)).toBe(false);
    expect(doorOpen(undefined, now)).toBe(false);
  });

  it('opens a release over in its final state: what was announced, its date and quantity line as announced, never an end figure', () => {
    const m = livePastModel(over(), 'Europe/Paris');
    expect(m).toEqual({
      name: 'MONOLITHE',
      line: 'RING · ORBIT',
      facts: '11 OCT 2026 · 25 PIECES',
      picture: { src: media(1), alt: 'The model of MONOLITHE, photographed by ORBES', kind: 'photo' },
      lookbook: 'monolithe',
      description: 'A ring cut from one block of silver.',
    });
    // The date on this phone's calendar: T0 at 17:00 UTC is the 12th in Tokyo.
    expect(livePastModel(over(), 'Asia/Tokyo').facts).toBe('12 OCT 2026 · 25 PIECES');
    // Ended before its name or its photograph was revealed: named nowhere, the seal on its plate.
    expect(livePastModel(over({ title: null, name: null, type: null, collection: null, description: null, imageUrl: null, silhouetteUrl: null, lookbook: null }), 'UTC')).toEqual({
      name: 'LIVE RELEASE',
      line: null,
      facts: '11 OCT 2026 · 25 PIECES',
      picture: null,
      lookbook: null,
      description: null,
    });
    // A whole page, ENDED while a hold runs to its deadline, reads the same for those not in it: no size, no stock.
    expect(livePastModel(sheet({ phase: 'ENDED', lookbook: 'monolithe' }), 'Europe/Paris')).toMatchObject({ name: 'MONOLITHE', facts: '11 OCT 2026 · 25 PIECES' });
    expect(JSON.stringify(livePastModel(sheet({ phase: 'ENDED' }), 'UTC'))).not.toMatch(/48|52|56|4 800|stock/);
    expect(isEndedSheet(over())).toBe(true);
  });
});

describe('the room', () => {
  it('checks the account, its access, its size, the connection and the clock before T0', () => {
    const access = { allowed: true, tier: 2, missing: null, participations: null };
    expect(readyChecks({ access, size: '52', connection: 'live', synced: true })).toEqual([
      { label: 'SIGNED IN', value: '', ok: true },
      { label: 'ACCESS', value: 'PLATINE', ok: true },
      { label: 'SIZE', value: '52', ok: true },
      { label: 'CONNECTION', value: 'LIVE', ok: true },
      { label: 'CLOCK', value: 'SYNCED TO ORBES', ok: true },
    ]);
    const pending = readyChecks({ access: { allowed: true, tier: 0, missing: null, participations: null }, size: null, connection: 'reconnecting', synced: false });
    expect(pending.map((c) => [c.value, c.ok])).toEqual([['', true], ['GRANTED', true], ['TO CHOOSE', false], ['RECONNECTING', false], ['SYNCING', false]]);
  });

  it('offers the sizes with stock, the one of I\'LL BE THERE preselected, the only one of a one-size release', () => {
    const s = sheet();
    expect(sizeChoices(s, room(), S52)).toEqual([
      { id: S48, label: '48', available: true, selected: false },
      { id: S52, label: '52', available: true, selected: true },
    ]);
    // After T0, the server's rule for a late entry: a size whose pieces are all in turns or held can still be chosen (one
    // may return, the late arrival joins behind); only a size whose every piece is confirmed cannot.
    const late = (left: number, held: number) => room({ sizes: [{ id: S48, label: '48', stock: 3, left, held }] });
    expect(sizeChoices(s, late(0, 1), null)[0]!.available).toBe(true);
    expect(sizeChoices(s, late(0, 3), null)[0]!.available).toBe(true);
    expect(sizeChoices(s, late(0, 0), null)[0]!.available).toBe(false);
    expect([servable(late(0, 1).sizes[0]!), servable(late(2, 1).sizes[0]!), servable(null)]).toEqual([1, 3, null]);
    const interest = { dropId: ID, size: { id: S48, label: '48' }, since: iso(T0 - 86_400_000) };
    expect(initialSize(s, null, interest)).toBe(S48);
    expect(initialSize(s, entry(), interest)).toBe(S52);
    expect(initialSize(s, null, { ...interest, size: { id: S56, label: '56' } })).toBeNull();
    expect(initialSize(s, null, null)).toBeNull();
    expect(initialSize(sheet({ sizes: [{ id: S52, label: 'ONE SIZE', stock: 25 }] }), null, null)).toBe(S52);
  });

  it('turns the lock\'s orbits back into alignment during the last minute, a step a second, aligned at T0', () => {
    for (let k = 0; k < SEAL_RINGS; k++) {
      const scrambled = lockAngle(k, LOCK_MS + 30_000);
      expect(Math.abs(scrambled), `${k}`).toBeGreaterThanOrEqual(24);
      expect(Math.sign(scrambled)).toBe(k % 2 === 0 ? 1 : -1);
      expect(lockAngle(k, LOCK_MS)).toBe(scrambled);
      expect(lockAngle(k, 30_000)).toBeCloseTo(scrambled / 2, 9);
      // One step a second: the same angle within a second.
      expect(lockAngle(k, 29_001)).toBe(lockAngle(k, 30_000));
      expect(lockAngle(k, 0)).toBe(0);
      expect(lockAngle(k, -500)).toBe(0);
    }
    expect(SEAL_RINGS).toBe(CODE01_RINGS.length);
  });

  it('ticks each of the last ten seconds once, never before nor at T0', () => {
    expect(tickSecond(10_000)).toBe(10);
    expect(tickSecond(9_400)).toBe(10);
    expect(tickSecond(9_000)).toBe(9);
    expect(tickSecond(1)).toBe(1);
    expect(tickSecond(10_001)).toBeNull();
    expect(tickSecond(0)).toBeNull();
    const seconds = new Set<number>();
    for (let ms = 12_000; ms > -1_000; ms -= 250) {
      const s = tickSecond(ms);
      if (s !== null) seconds.add(s);
    }
    expect([...seconds]).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });
});

describe('the line, the turn and the piece held', () => {
  it('says the pieces left overall and in your size, the held pieces that may return, and draws them', () => {
    const r = room({ phase: 'LIVE', quantity: 25, left: 16, held: 2, sizes: [{ id: S52, label: '52', stock: 6, left: 4, held: 1 }] });
    const f = lineFacts(r, S52, '52');
    expect(f.left).toBe('16 OF 25 LEFT · 4 IN SIZE 52');
    expect(f.held).toBe('2 HELD PIECES MAY RETURN');
    expect(f.cells).toHaveLength(25);
    expect(f.cells!.filter((c) => c === 'gone')).toHaveLength(7);
    expect(f.cells!.filter((c) => c === 'held')).toHaveLength(2);
    expect(f.cells!.slice(0, 9)).toEqual([...Array(7).fill('gone'), 'held', 'held']);
    expect(lineFacts(room({ held: 1 }), S48, '48').held).toBe('1 HELD PIECE MAY RETURN');
    expect(lineFacts(room(), S48, '48').held).toBeNull();
    // Past fifty pieces, a bar.
    const big = lineFacts(room({ quantity: 1_000, left: 250, held: 0 }), S52, '52');
    expect(big.cells).toBeNull();
    expect(big.taken).toBe(0.75);
  });

  it('announces the place and who is ahead in your size, in words', () => {
    expect(placeAnnouncement(entry({ status: 'QUEUED', position: 14, ahead: 3 }))).toBe('Your place: 14. 3 ahead of you in size 52.');
    expect(placeAnnouncement(entry({ status: 'QUEUED', position: 2, ahead: 0 }))).toBe('Your place: 2. You are next in size 52.');
    expect(placeAnnouncement(entry())).toBeNull();
    expect(LIVE.ahead(3, '52')).toBe('3 AHEAD OF YOU IN SIZE 52');
  });

  it('measures a window at the server\'s time: what is left, and its share', () => {
    expect(windowLeft(iso(T0), iso(T0 + 30_000), T0 + 6_000)).toEqual({ remainingMs: 24_000, fraction: 0.8 });
    expect(windowLeft(iso(T0), iso(T0 + 30_000), T0 + 40_000)).toEqual({ remainingMs: 0, fraction: 0 });
    expect(windowLeft('x', iso(T0), T0)).toEqual({ remainingMs: 0, fraction: 0 });
  });

  it('offers the add-ons with their price per piece, the one kept when chosen', () => {
    const held = entry({ status: 'SECURED', addons: [{ id: 'a1', label: 'Engraving', priceMinor: 12_000 }] });
    expect(addonChoices(sheet(), held)).toEqual([
      { id: 'a1', label: 'ENGRAVING', line: 'Your initials', price: '+ € 120', selected: true },
      { id: 'a2', label: 'GIFT BOX', line: null, price: '+ € 90', selected: false },
    ]);
  });
});

describe('the release announced, and its card in THE RELEASES', () => {
  it('states its piece, price, opening in Paris, rule, quantity, room and the draw of the places', () => {
    const m = liveSheetModel(sheet(), 'America/New_York');
    expect(m).toMatchObject({
      name: 'MONOLITHE',
      named: true,
      line: 'RING · ORBIT',
      price: '€ 4 800',
      offer: '€ 4 800 · 25 PIECES',
      when: { paris: 'SUNDAY 11 OCTOBER · 19:00 PARIS', local: 'SUNDAY 11 OCTOBER · 13:00 ON THIS PHONE' },
      access: 'FOR OWNERS FROM PLATINE',
      quantity: '25 PIECES · ONE PER COLLECTOR',
      roomOpens: 'THE ROOM OPENS 5 MINUTES BEFORE',
      rule: LIVE.rule(true),
      picture: { src: media(1), kind: 'photo' },
      calendarHref: `/api/v1/live/${ID}/calendar.ics`,
    });
    expect(liveSheetModel(sheet({ perAccount: 2, roomOpensMinutes: 1, tierPriority: false }), 'Europe/Paris')).toMatchObject({ quantity: '25 PIECES · UP TO 2 PER COLLECTOR', roomOpens: 'THE ROOM OPENS 1 MINUTE BEFORE', rule: LIVE.rule(false) });
    expect(LIVE.rule(false)).not.toContain('tier');
  });

  it('states the rules beyond the tier as the server words them, and A SURPRISE IN EVERY BOX, never what it is (plan LIVE RELEASE+)', () => {
    expect(liveSheetModel(sheet(), 'Europe/Paris').surprise).toBeNull();
    expect(liveSheetModel(sheet({ surprise: true }), 'Europe/Paris').surprise).toBe('A SURPRISE IN EVERY BOX');
    expect(LIVE.surprise).toBe('A SURPRISE IN EVERY BOX');
    const access = (text: string) => liveSheetModel(sheet({ access: { minTier: 0, text } }), 'Europe/Paris').access;
    expect(access('collectors who have taken part in 3 releases')).toBe('FOR COLLECTORS WHO HAVE TAKEN PART IN 3 RELEASES');
    expect(access('selected collectors')).toBe('FOR SELECTED COLLECTORS');
    expect(access('owners from PLATINE or collectors who have taken part in 3 releases')).toBe('FOR OWNERS FROM PLATINE OR COLLECTORS WHO HAVE TAKEN PART IN 3 RELEASES');
  });

  it('shows each stage only once the server sends it: the silhouette, else the seal; no name before its time', () => {
    const before = sheet({ name: null, type: null, collection: null, title: null, imageUrl: null, silhouetteUrl: null, revealed: { silhouette: false, name: false, photo: false } });
    expect(liveSheetModel(before, 'Europe/Paris')).toMatchObject({ name: 'TO BE REVEALED', named: false, line: null, picture: null });
    expect(pictureOf({ ...before, silhouetteUrl: media(2) })).toEqual({ src: media(2), alt: 'The silhouette of LIVE RELEASE', kind: 'silhouette' });
    expect(pictureOf({ ...before, silhouetteUrl: 'https://elsewhere.example/s.png' })).toBeNull();
  });

  it('offers SEE THE MODEL only once the server sends its sheet with the photograph: never before, never an address it cannot be', () => {
    expect(liveSheetModel(sheet(), 'Europe/Paris').lookbook).toBeNull();
    expect(liveSheetModel(sheet({ lookbook: 'monolithe' }), 'Europe/Paris').lookbook).toBe('monolithe');
    // Before the photograph's stage the server sends neither the photograph nor the sheet.
    expect(liveSheetModel(sheet({ imageUrl: null, lookbook: null, revealed: { silhouette: true, name: true, photo: false } }), 'Europe/Paris')).toMatchObject({ lookbook: null, picture: { kind: 'silhouette' } });
    for (const bad of ['../admin', 'Monolithe', 'mono lithe', '', 'x'.repeat(81)]) expect(liveSheetModel(sheet({ lookbook: bad }), 'Europe/Paris').lookbook).toBeNull();
  });

  it('lists its LIVE RELEASES on vault plates: where each stands, its name or TO BE REVEALED, its opening, price, quantity, limit per collector and rule', () => {
    const [announced, room0, live, unnamed] = liveCards(
      [
        card(),
        card({ id: ID.replace('8a1d', '8a1e'), phase: 'ROOM' }),
        card({ id: ID.replace('8a1d', '8a1f'), phase: 'LIVE' }),
        card({ id: ID.replace('8a1d', '8a2a'), name: null, imageUrl: null, silhouetteUrl: null }),
        { ...card(), id: 'not-an-id' },
        { ...card(), kind: 'DRAW' as never },
      ],
      'Europe/Paris',
    );
    expect(announced).toEqual({
      id: ID,
      href: `/verify/releases/${ID}`,
      kind: 'LIVE RELEASE',
      title: 'MONOLITHE',
      when: { paris: 'SUNDAY 11 OCTOBER · 19:00 PARIS', local: null },
      line: '€ 4 800 · 25 PIECES · ONE PER COLLECTOR',
      access: 'FOR OWNERS FROM PLATINE',
      picture: { src: media(1), alt: 'The model of MONOLITHE, photographed by ORBES', kind: 'photo' },
      reveals: [],
      interest: null,
    });
    expect(room0!.kind).toBe('LIVE RELEASE · THE ROOM IS OPEN');
    expect(live!.kind).toBe('LIVE RELEASE · LIVE NOW');
    expect(unnamed).toMatchObject({ title: 'TO BE REVEALED', picture: null });
    expect(liveCards([card({ perAccount: 2 })], 'Europe/Paris')[0]!.line).toBe('€ 4 800 · 25 PIECES · UP TO 2 PER COLLECTOR');
    expect(liveCards([card()], 'Asia/Tokyo')[0]!.when.local).toBe('MONDAY 12 OCTOBER · 02:00 ON THIS PHONE');
  });
});

describe('the announcements: the release calendar, I\'LL BE THERE, the banner', () => {
  const stages = (at: number[]) => (['SILHOUETTE', 'NAME', 'PHOTO'] as const).slice(3 - at.length).map((stage, i) => ({ stage, at: iso(at[i]!) }));

  it('dates the reveals still to come in Paris, in order, those at the same minute said together; never a stage the server did not send', () => {
    // Friday 9 October 18:00, Saturday 10 October 12:00 in Paris (16:00, 10:00 UTC).
    const fri = Date.parse('2026-10-09T16:00:00.000Z');
    const sat = Date.parse('2026-10-10T10:00:00.000Z');
    expect(revealCalendar({ reveals: stages([fri, sat, sat]) })).toEqual([
      { label: 'THE SILHOUETTE', when: 'FRIDAY 9 OCTOBER · 18:00 PARIS', at: iso(fri) },
      { label: 'THE NAME AND THE PHOTOGRAPH', when: 'SATURDAY 10 OCTOBER · 12:00 PARIS', at: iso(sat) },
    ]);
    expect(revealCalendar({ reveals: stages([fri, fri + 20_000, sat]) }).map((d) => d.label)).toEqual(['THE SILHOUETTE AND THE NAME', 'THE PHOTOGRAPH']);
    expect(revealCalendar({ reveals: stages([sat]) })).toEqual([{ label: 'THE PHOTOGRAPH', when: 'SATURDAY 10 OCTOBER · 12:00 PARIS', at: iso(sat) }]);
    expect(revealCalendar({ reveals: [] })).toEqual([]);
    expect(revealCalendar({ reveals: [{ stage: 'NAME', at: 'soon' }, { stage: 'SECRET' as never, at: iso(fri) }] })).toEqual([]);
    expect(revealCalendar({ reveals: undefined as never })).toEqual([]);
    const [c] = liveCards([card({ name: null, reveals: stages([fri, sat]), interest: 428 })], 'Europe/Paris');
    expect(c).toMatchObject({ title: 'TO BE REVEALED', reveals: [{ label: 'THE NAME' }, { label: 'THE PHOTOGRAPH' }], interest: '428 COLLECTORS WILL BE THERE' });
  });

  it('counts I\'LL BE THERE in words, saying nothing before the first', () => {
    expect(interestLine(0)).toBeNull();
    expect(interestLine(1)).toBe('1 COLLECTOR WILL BE THERE');
    expect(interestLine(428)).toBe('428 COLLECTORS WILL BE THERE');
    expect(interestLine(Number.NaN)).toBeNull();
  });

  /** The card as the server answers at `at`: the reveals still to come (T0 - 2 h, T0 - 1 h), the phase reached. */
  const answer = (at: number, extra: Partial<LiveCard> = {}): LiveCard =>
    card({
      phase: at < T0 - 300_000 ? 'ANNOUNCED' : at < T0 ? 'ROOM' : 'LIVE',
      reveals: stages([T0 - 7_200_000, T0 - 3_600_000].filter((t) => t > at)),
      ...extra,
    });
  const WATCH = 60_000;

  it('reads THE RELEASES again at the next moment that changes a card: a stage, the room, T0, the end; within the watch while a room is open or a release live', () => {
    expect(nextChange([answer(T0 - 10 * 3_600_000)], T0 - 10 * 3_600_000, WATCH)).toBe(T0 - 7_200_000);
    expect(nextChange([answer(T0 - 7_200_000)], T0 - 7_200_000, WATCH)).toBe(T0 - 3_600_000);
    expect(nextChange([answer(T0 - 3_600_000)], T0 - 3_600_000, WATCH)).toBe(T0 - 300_000);
    // The room open, then live: sold out or ended by ORBES before its time, it leaves the list within the watch.
    expect(nextChange([answer(T0 - 300_000)], T0 - 300_000, WATCH)).toBe(T0 - 240_000);
    expect(nextChange([answer(T0 - 30_000)], T0 - 30_000, WATCH)).toBe(T0);
    expect(nextChange([answer(T0)], T0, WATCH)).toBe(T0 + WATCH);
    expect(nextChange([answer(T0 + 3_590_000)], T0 + 3_590_000, WATCH)).toBe(T0 + 3_600_000);
    // One release in its room watches the list for all.
    const later = card({ roomOpensAt: iso(T0 + 86_400_000 - 300_000), opensAt: iso(T0 + 86_400_000), closesAt: iso(T0 + 90_000_000) });
    expect(nextChange([later, answer(T0 - 200_000)], T0 - 200_000, WATCH)).toBe(T0 - 140_000);
    expect(nextChange([later], T0, WATCH)).toBe(T0 + 86_400_000 - 300_000);
    expect(nextChange([], T0, WATCH)).toBeNull();
  });

  it('reads THE RELEASES again shortly when the answer still holds ahead a moment this device has passed: never a stage dropped from the schedule', () => {
    // A reveal still listed, read a moment before it (or this device ahead of the server).
    expect(nextChange([answer(T0 - 7_200_001)], T0 - 7_199_500, WATCH)).toBe(T0 - 7_199_500 + CHANGE_RETRY_MS);
    // Once the server no longer lists it, the next stage.
    expect(nextChange([answer(T0 - 7_200_000)], T0 - 7_199_500, WATCH)).toBe(T0 - 3_600_000);
    // A phase not reached in the answer: the room, T0, the end.
    expect(nextChange([answer(T0 - 300_001)], T0 - 299_000, WATCH)).toBe(T0 - 299_000 + CHANGE_RETRY_MS);
    expect(nextChange([answer(T0 - 1)], T0 + 100, WATCH)).toBe(T0 + 100 + CHANGE_RETRY_MS);
    expect(nextChange([answer(T0 + 3_599_999)], T0 + 3_600_100, WATCH)).toBe(T0 + 3_600_100 + CHANGE_RETRY_MS);
    expect(CHANGE_RETRY_MS).toBeLessThan(WATCH);
  });

  it('says the banner OPENS IN to T0 on the server\'s clock, then THE ROOM IS OPEN, then LIVE NOW; hidden at the end; the name once revealed', () => {
    const b = { id: ID, phase: 'ANNOUNCED' as const, name: null, nameAt: iso(T0 - 3_600_000), roomOpensAt: iso(T0 - 300_000), opensAt: iso(T0), closesAt: iso(T0 + 3_600_000) };
    // hh:mm:ss throughout, as the plan words it: its hours past 24 a day or more ahead.
    expect(bannerModel(b, T0 - 3 * 86_400_000 - (14 * 60 + 9) * 1000)).toMatchObject({ phase: 'ANNOUNCED', lead: 'LIVE RELEASE', state: 'OPENS IN', clock: '72:14:09', href: `/verify/releases/${ID}` });
    expect(bannerModel(b, T0 - 86_400_000)!.clock).toBe('24:00:00');
    expect(bannerModel(b, T0 - 30 * 86_400_000)!.clock).toBe('720:00:00');
    expect(bannerModel(b, T0 - (2 * 3600 + 14 * 60 + 9) * 1000)).toMatchObject({ state: 'OPENS IN', clock: '02:14:09' });
    expect(bannerModel(b, T0 - 300_001)!.clock).toBe('00:05:01');
    expect(bannerModel({ ...b, name: 'Monolithe' }, T0 - 300_000)).toMatchObject({ phase: 'ROOM', lead: 'LIVE RELEASE · MONOLITHE', state: 'THE ROOM IS OPEN', clock: null });
    expect(bannerModel(b, T0)).toMatchObject({ phase: 'LIVE', state: 'LIVE NOW', clock: null });
    expect(bannerModel(b, T0 + 3_600_000 - 1)!.phase).toBe('LIVE');
    expect(bannerModel(b, T0 + 3_600_000)).toBeNull();
    expect(bannerModel(null, T0)).toBeNull();
    expect(bannerModel({ ...b, id: 'nope' }, T0)).toBeNull();
    expect(bannerModel({ ...b, closesAt: 'later' }, T0)).toBeNull();
  });

  it('measures the server\'s clock by its round trips, null when none comes back', async () => {
    let n = 0;
    const read = async () => {
      n++;
      return iso(Date.now() + 5_000);
    };
    const m = await measureClock(read, 2);
    expect(n).toBe(2);
    expect(m!.offset).toBeGreaterThan(4_900);
    expect(m!.offset).toBeLessThan(5_100);
    expect(await measureClock(() => Promise.reject(new Error('offline')))).toBeNull();
  });
});

describe('MY PIECES: the account\'s LIVE RELEASE entries', () => {
  it('lists each with its release, its status in words, its reference once held, ORBES Client Services once confirmed', () => {
    const release = { id: ID, phase: 'ENDED' as const, endedReason: 'SOLD_OUT' as const, title: 'Monolithe — live', name: 'Monolithe', imageUrl: null, opensAt: iso(T0), closesAt: iso(T0 + 3_600_000), afterRoomOf: null };
    const list: LiveAccountEntry[] = [
      { release, entry: entry({ status: 'CONFIRMED' }) },
      { release: { ...release, id: ID.replace('8a1d', '8a1e'), title: null, name: null }, entry: entry({ id: ID, status: 'MISSED' }) },
    ];
    const contacts = { email: 'clientservices@theorbes.com' };
    const [confirmed, missed] = myLiveEntries(list, { clientServices: contacts });
    expect(confirmed).toMatchObject({ dropId: ID, href: `/verify/releases/${ID}`, title: 'MONOLITHE — LIVE', stateLabel: 'LIVE RELEASE' });
    expect(confirmed!.entry).toMatchObject({ label: 'CONFIRMED', sentence: 'You secured your piece in size 52. Its steps follow in YOUR ORDERS.', reference: 'REFERENCE LR-01EDCB93', entryId: null, canEnter: false });
    expect(confirmed!.entry.contact?.mailto).toContain('LR-01EDCB93');
    // Its payment and delivery are its order's steps, in YOUR ORDERS (the vault's CONFIRMED screen keeps LIVE.reservedIn).
    expect(confirmed!.entry.sentence).not.toContain('settle payment');
    // A past fact, true once the order is paid, shipped, delivered, cancelled or returned: never "is reserved".
    expect(confirmed!.entry.sentence).not.toContain('reserved');
    expect(myLiveEntries([{ release, entry: entry({ status: 'CONFIRMED', quantity: 2 }) }], {})[0]!.entry.sentence).toBe('You secured 2 pieces in size 52. Their steps follow in YOUR ORDERS.');
    expect(missed).toMatchObject({ title: 'LIVE RELEASE', entry: { label: 'TURN PASSED', sentence: LIVE.sentence.MISSED, reference: null, contact: null } });
    expect(myLiveEntries([{ release: { ...release, id: 'x' }, entry: entry() }], {})).toEqual([]);
  });

  it('opens an after-room\'s entry through the release it follows, said as THE AFTER-ROOM', () => {
    const child = ID.replace('8a1d', '8a1f');
    const release = { id: child, phase: 'ENDED' as const, endedReason: 'SOLD_OUT' as const, title: 'Night · THE AFTER-ROOM', name: 'Afterglow', imageUrl: null, opensAt: iso(T0), closesAt: iso(T0 + 900_000), afterRoomOf: ID };
    const [m] = myLiveEntries([{ release, entry: entry({ status: 'CONFIRMED' }) }], {});
    expect(m).toMatchObject({ dropId: child, afterRoomOf: ID, href: `/verify/releases/${ID}/after-room`, title: 'NIGHT · THE AFTER-ROOM', stateLabel: 'THE AFTER-ROOM' });
    // A malformed one is the release's own.
    expect(myLiveEntries([{ release: { ...release, afterRoomOf: 'x' }, entry: entry() }], {})[0]).toMatchObject({ href: `/verify/releases/${child}`, stateLabel: 'LIVE RELEASE' });
  });
});

describe('the seal: the specimen, never a piece\'s code', () => {
  it('draws the ORBES CODE from fixed bytes and eight glyphs of GENOME-01, which no signature verifies', () => {
    const data = specimenData();
    expect(data).toHaveLength(CODE01.ecc.dataBytes);
    expect(specimenData()).toEqual(data);
    expect(new Set(data).size).toBeGreaterThan(40);
    expect(SPECIMEN_GLYPHS).toHaveLength(CODE01.genome.count);
    for (const g of SPECIMEN_GLYPHS) expect(g >= 0 && g < 16).toBe(true);
    // Not a code ORBES issued: its frame does not even hold (no valid CRC), so no scan of the screen reads a piece.
    expect(() => unframeCodeData(data)).toThrow();
  });
});

describe('the vault palette (brand.css), computed', () => {
  const brand = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/web/shared/brand.css'), 'utf8');
  const token = (name: string) => new RegExp(`${name}:\\s*(#[0-9a-f]{6});`, 'i').exec(brand)?.[1] ?? '';
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };

  it('holds the plan\'s tokens, and every text colour at 4.5 : 1 or more on the ground and on the plate; faint for decoration only', () => {
    expect([token('--vault-ground'), token('--vault-ink'), token('--vault-soft'), token('--vault-faint'), token('--vault-plate')]).toEqual(['#0a0a0a', '#f6f2ea', '#a7a29a', '#6f6a63', '#141312']);
    for (const ground of ['--vault-ground', '--vault-plate']) {
      for (const text of ['--vault-ink', '--vault-soft']) expect(contrast(token(text), token(ground)), `${text} on ${ground}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token('--vault-faint'), token(ground))).toBeLessThan(4.5);
    }
    // The primary action: the ground's ink on ivory.
    expect(contrast(token('--vault-ground'), token('--vault-ink'))).toBeGreaterThanOrEqual(4.5);
    expect(brand).toMatch(/--vault-hairline: rgba\(246, 242, 234, 0\.14\);/);
    expect(brand).toMatch(/--vault-hairline-strong: rgba\(246, 242, 234, 0\.34\);/);
  });
});
