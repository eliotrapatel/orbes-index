/**
 * THE SET's LIVE RELEASE on the collector's side (macro scope of 2026-10-20, K44 T1 and T4; plan MACRO M3 §5.4, step
 * M3.19), pure: its page (THE SET · 3 PIECES, its pieces' names, € 12 000 · 5 SETS · 1 SET PER PERSON); YOUR SIZES, a
 * picker per piece preselected from the entry, I'LL BE THERE, YOUR SIZES or the only size, the sizes sent once every piece
 * has one; READY CHECK's SIZES; the line in sets, the place read in every size; sold out in one of its sizes, said with its
 * piece; the hold's pieces each in its size; MY PIECES' set words; the room's bodies with a size per piece. The screens are
 * driven in Chromium by the content states (set-live-*, set-room*).
 */
import { describe, expect, it } from 'vitest';
import { ApiClient } from '../../src/web/verify/api.js';
import { LIVE, SETS } from '../../src/web/verify/copy.js';
import {
  aheadLine,
  formatMoney,
  heldPieces,
  initialSetPick,
  isSetEntry,
  liveScreen,
  liveSetChoice,
  livePieces,
  liveSheetModel,
  myLiveEntries,
  pickedLabels,
  pieceSizeChoices,
  placeAnnouncement,
  readyChecks,
  setLineFacts,
  setShort,
  setSizesLine,
} from '../../src/web/verify/live-model.js';
import type { LiveAccountEntry, LiveEntry, LiveInterest, LiveRoom, LiveSheet } from '../../src/web/verify/types.js';
import { brandForbiddenTerms, EXTRA_FORBIDDEN_EN, findForbidden } from '../docs/lexicon.js';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MEDIA = (c: string) => `/api/v1/media/${c.repeat(64)}`;
const PIECES = [
  { piece: 1, name: 'MONOLITHE', variant: 'Gold', type: 'BRACELET', collection: 'ORBITAL', imageUrl: MEDIA('a'), lookbook: null },
  { piece: 2, name: 'HALO', variant: null, type: 'RING', collection: null, imageUrl: MEDIA('b'), lookbook: null },
  { piece: 3, name: 'CONSTELLATION ORBITALE', variant: null, type: 'NECKLACE', collection: null, imageUrl: MEDIA('c'), lookbook: null },
];
const SIZES = [
  { id: ID(11), piece: 1, label: '16', stock: 1 },
  { id: ID(12), piece: 1, label: '17', stock: 2 },
  { id: ID(21), piece: 2, label: '52', stock: 2 },
  { id: ID(22), piece: 2, label: '56', stock: 1 },
  { id: ID(23), piece: 2, label: '58', stock: 0 },
  { id: ID(31), piece: 3, label: '45', stock: 3 },
];

function sheet(extra: Partial<LiveSheet> = {}): LiveSheet {
  return {
    id: ID(1),
    kind: 'LIVE',
    phase: 'ROOM',
    revealed: { silhouette: true, name: true, photo: true },
    stages: { silhouetteAt: '2026-10-01T10:00:00.000Z', nameAt: '2026-10-02T10:00:00.000Z', photoAt: '2026-10-03T10:00:00.000Z' },
    reveals: [],
    title: 'THE ORBITAL SET, RELEASED LIVE',
    name: 'THE ORBITAL SET',
    variant: null,
    type: 'SET',
    collection: null,
    silhouetteUrl: null,
    imageUrl: null,
    lookbook: null,
    announcedAt: '2026-10-01T10:00:00.000Z',
    roomOpensAt: '2026-10-05T16:42:00.000Z',
    opensAt: '2026-10-05T16:52:00.000Z',
    closesAt: '2026-10-05T17:52:00.000Z',
    priceMinor: 1_200_000,
    currency: 'EUR',
    quantityLine: '5 SETS',
    perAccount: 1,
    access: { minTier: 1, text: 'owners' },
    surprise: false,
    interest: 0,
    set: { name: 'THE ORBITAL SET', pieces: PIECES },
    description: null,
    sizes: SIZES,
    addons: [],
    roomOpensMinutes: 10,
    turnSeconds: 300,
    payMinutes: 10,
    tierPriority: true,
    ...extra,
  };
}

function room(left: Record<string, [number, number]> = {}): LiveRoom {
  const sizes = SIZES.map((z) => ({ id: z.id, label: z.label, piece: z.piece, stock: z.stock, left: left[z.id]?.[0] ?? z.stock, held: left[z.id]?.[1] ?? 0 }));
  return {
    id: ID(1),
    phase: 'LIVE',
    paused: false,
    over: false,
    endedReason: null,
    roomOpensAt: '2026-10-05T16:42:00.000Z',
    opensAt: '2026-10-05T16:52:00.000Z',
    closesAt: '2026-10-05T17:52:00.000Z',
    inRoom: 4,
    line: 2,
    quantity: 5,
    quantityLine: '5 SETS',
    left: 2,
    held: 2,
    sizes,
    pieces: PIECES.map((p) => ({ piece: p.piece, name: p.name, variant: p.variant, imageUrl: p.imageUrl, sizes: sizes.filter((z) => z.piece === p.piece) })),
    message: null,
  };
}

function entry(extra: Partial<LiveEntry> = {}): LiveEntry {
  return {
    id: ID(9),
    dropId: ID(1),
    status: 'QUEUED',
    size: { id: ID(12), label: '17' },
    sizes: [
      { piece: 1, id: ID(12), label: '17' },
      { piece: 2, id: ID(22), label: '56' },
      { piece: 3, id: ID(31), label: '45' },
    ],
    quantity: 1,
    tier: 1,
    position: 5,
    ahead: 1,
    joinedAt: '2026-10-05T16:46:00.000Z',
    turn: null,
    hold: null,
    confirmedAt: null,
    endedAt: null,
    letIn: false,
    addons: [],
    currency: 'EUR',
    priceMinor: 1_200_000,
    totalMinor: 1_200_000,
    ...extra,
  };
}

describe('a set\'s LIVE RELEASE page (K44 T1, T4)', () => {
  it('says THE SET · 3 PIECES, its pieces\' names and photographs, and its offer with 1 SET PER PERSON', () => {
    const m = liveSheetModel(sheet(), 'Europe/Paris');
    expect(m.line).toBe('THE SET · 3 PIECES');
    expect(m.set?.names).toBe('MONOLITHE IN GOLD · HALO · CONSTELLATION ORBITALE');
    expect(m.set?.images.map((x) => x.src)).toEqual([MEDIA('a'), MEDIA('b'), MEDIA('c')]);
    expect(m.offer).toBe(`${formatMoney(1_200_000, 'EUR')} · 5 SETS · 1 SET PER PERSON`);
    expect(m.perAccount).toBe('1 SET PER PERSON');
    expect(m.quantity).toBe('5 SETS · 1 SET PER PERSON');
    // A model's release: as before.
    const model = liveSheetModel(sheet({ set: undefined, name: 'MONOLITHE', type: 'BRACELET', collection: 'ORBITAL', quantityLine: '25 PIECES' }), 'Europe/Paris');
    expect([model.line, model.offer, model.perAccount, model.set]).toEqual(['BRACELET · ORBITAL', `${formatMoney(1_200_000, 'EUR')} · 25 PIECES`, 'ONE PER COLLECTOR', null]);
  });

  it('gives a picker per piece, each its sizes with stock, named PIECE n before the name\'s stage', () => {
    const pieces = livePieces(sheet());
    expect(pieces.map((p) => [p.piece, p.line, p.sizes.map((z) => z.label)])).toEqual([
      [1, 'MONOLITHE IN GOLD · BRACELET', ['16', '17']],
      [2, 'HALO · RING', ['52', '56']],
      [3, 'CONSTELLATION ORBITALE · NECKLACE', ['45']],
    ]);
    const veiled = livePieces(sheet({ set: { name: null, pieces: PIECES.map((p) => ({ ...p, name: null, variant: null, type: null })) } }));
    expect(veiled.map((p) => p.name)).toEqual(['PIECE 1', 'PIECE 2', 'PIECE 3']);
    expect(livePieces(sheet({ set: undefined }))).toEqual([]);
    // A size no piece of which can still be served is greyed in its piece.
    const choices = pieceSizeChoices(pieces[1]!, room({ [ID(22)]: [0, 0] }), ID(21));
    expect(choices.map((c) => [c.label, c.available, c.selected])).toEqual([
      ['52', true, true],
      ['56', false, false],
    ]);
  });

  it('preselects each piece\'s size: the entry\'s, I\'LL BE THERE\'s, YOUR SIZES\', the only one', () => {
    const pieces = livePieces(sheet());
    const saved = [{ piece: 1, id: ID(12), label: '17' }, { piece: 2, id: ID(21), label: '52' }];
    const fromSaved = initialSetPick(pieces, null, null, saved);
    expect([...fromSaved]).toEqual([
      [1, { sizeId: ID(12), from: 'saved' }],
      [2, { sizeId: ID(21), from: 'saved' }],
      [3, { sizeId: ID(31), from: 'only' }],
    ]);
    const interest: LiveInterest = { dropId: ID(1), size: { id: ID(11), label: '16' }, sizes: [{ piece: 1, id: ID(11), label: '16' }, { piece: 2, id: ID(22), label: '56' }, { piece: 3, id: ID(31), label: '45' }], since: '2026-10-04T10:00:00.000Z' };
    expect(initialSetPick(pieces, null, interest, saved).get(1)).toEqual({ sizeId: ID(11), from: 'interest' });
    const held = entry({ status: 'WAITING', position: null, ahead: null });
    expect(initialSetPick(pieces, held, interest, saved).get(2)).toEqual({ sizeId: ID(22), from: 'entry' });
    // A size no longer offered is never preselected.
    expect(initialSetPick(pieces, null, null, [{ piece: 2, id: ID(23), label: '58' }]).has(2)).toBe(false);
  });

  it('sends the sizes once every piece has one of its own, and says them on one line', () => {
    const pieces = livePieces(sheet());
    const picked = new Map([
      [1, { sizeId: ID(12) }],
      [2, { sizeId: ID(21) }],
    ]);
    expect(liveSetChoice(pieces, picked)).toBeNull();
    expect(pickedLabels(pieces, picked)).toBeNull();
    picked.set(3, { sizeId: ID(31) });
    expect(liveSetChoice(pieces, picked)).toEqual([
      { piece: 1, sizeId: ID(12) },
      { piece: 2, sizeId: ID(21) },
      { piece: 3, sizeId: ID(31) },
    ]);
    expect(SETS.live.sizes(pickedLabels(pieces, picked)!)).toBe('SIZE 17 · 52 · 45');
    // Another piece's size is not this piece's.
    picked.set(3, { sizeId: ID(21) });
    expect(liveSetChoice(pieces, picked)).toBeNull();
    expect(setSizesLine(entry())).toBe('SIZE 17 · 56 · 45');
    expect(setSizesLine({ sizes: [] })).toBe('');
  });

  it('READY CHECK says SIZES, every size once chosen, TO CONFIRM while YOUR SIZES\' and not confirmed', () => {
    const access = { allowed: true, tier: 1, missing: null, participations: null } as const;
    const row = (size: string | null, toConfirm = false) => readyChecks({ access, size, toConfirm, connection: 'live', synced: true, set: true })[2]!;
    expect(row(null)).toEqual({ label: 'SIZES', value: LIVE.ready.choose, ok: false });
    expect(row('SIZE 17 · 52 · 45', true)).toEqual({ label: 'SIZES', value: 'SIZE 17 · 52 · 45 · TO CONFIRM', ok: false });
    expect(row('SIZE 17 · 52 · 45')).toEqual({ label: 'SIZES', value: 'SIZE 17 · 52 · 45', ok: true });
  });
});

describe('a set\'s line, turn and hold (K44 T1, T4)', () => {
  it('counts the line in sets and reads the place in every size', () => {
    const facts = setLineFacts(room());
    expect([facts.left, facts.held]).toEqual(['2 OF 5 SETS LEFT', '2 HELD SETS MAY RETURN']);
    expect(facts.cells).toEqual(['gone', 'held', 'held', 'free', 'free']);
    expect(aheadLine(entry())).toBe('1 AHEAD OF YOU IN YOUR SIZES');
    expect(aheadLine(entry({ ahead: 0 }))).toBe('YOU ARE NEXT IN YOUR SIZES');
    expect(placeAnnouncement(entry())).toBe('Your place: 5. 1 ahead of you in your sizes.');
    expect(isSetEntry(entry())).toBe(true);
    expect(isSetEntry(entry({ sizes: undefined }))).toBe(false);
  });

  it('is sold out in one of its sizes once no piece of it can serve the set, said with its piece', () => {
    const s = sheet({ phase: 'LIVE' });
    const now = Date.parse('2026-10-05T17:00:00.000Z');
    expect(liveScreen({ sheet: s, viewer: 'ready', room: room(), entry: entry(), now })).toBe('line');
    const gone = room({ [ID(22)]: [0, 0] });
    expect(setShort(gone, entry())).toEqual({ piece: 2, label: '56', name: 'HALO', held: 0 });
    expect(liveScreen({ sheet: s, viewer: 'ready', room: gone, entry: entry(), now })).toBe('soldOut');
    // A piece held in a turn may return: still in the line.
    expect(liveScreen({ sheet: s, viewer: 'ready', room: room({ [ID(22)]: [0, 1] }), entry: entry(), now })).toBe('line');
    expect(SETS.live.soldOut.title('HALO', '56')).toBe('HALO · SOLD OUT IN SIZE 56');
    expect(SETS.live.soldOut.stay('HALO', '56')).toBe('Every HALO in size 56 is taken. You keep your place in case one returns, or you may leave.');
  });

  it('lists the hold\'s pieces, each in its size, in the set\'s order', () => {
    const e = entry({ status: 'SECURED', sizes: [...entry().sizes!].reverse() });
    expect(heldPieces(e, room(), sheet())).toEqual([
      { name: 'MONOLITHE IN GOLD', size: 'SIZE 17' },
      { name: 'HALO', size: 'SIZE 56' },
      { name: 'CONSTELLATION ORBITALE', size: 'SIZE 45' },
    ]);
    // Without its page (an ended sheet), from the room.
    expect(heldPieces(e, room(), null).map((p) => p.name)).toEqual(['MONOLITHE IN GOLD', 'HALO', 'CONSTELLATION ORBITALE']);
    expect([SETS.live.yourSet, SETS.live.toSecure, SETS.live.reserved(1), SETS.live.reserved(2)]).toEqual(['YOUR SET', 'TO SECURE YOUR SET', 'YOUR SET IS RESERVED', 'YOUR 2 SETS ARE RESERVED']);
  });
});

describe('MY PIECES\' set entries (K44 T1)', () => {
  it('says the set held and secured, never « the piece »', () => {
    const release = { id: ID(1), phase: 'LIVE' as const, endedReason: null, title: 'THE ORBITAL SET, LIVE NOW', name: 'THE ORBITAL SET', imageUrl: null, opensAt: '2026-10-05T16:29:00.000Z', closesAt: '2026-10-05T18:29:00.000Z', afterRoomOf: null, set: { name: 'THE ORBITAL SET', pieces: PIECES } };
    const list: LiveAccountEntry[] = [
      { release, entry: entry({ status: 'SECURED' }) },
      { release, entry: entry({ id: ID(8), status: 'CONFIRMED' }) },
      { release, entry: entry({ id: ID(7), status: 'TURN' }) },
    ];
    const m = myLiveEntries(list);
    expect(m.map((x) => [x.entry.label, x.entry.sentence])).toEqual([
      ['SET HELD', 'Your set is held for you. Open the release to confirm it.'],
      ['CONFIRMED', 'You secured your set, each piece in its size. Its steps follow in YOUR ORDERS.'],
      ['YOUR TURN', 'It is your turn. Open the release to secure your set.'],
    ]);
  });
});

describe('the room\'s bodies of a set\'s LIVE RELEASE (K44 T1, T4)', () => {
  it('I\'LL BE THERE, ENTER and CHANGE SIZE send `sizes` (a size per piece) and the sets; a model\'s release its `sizeId`', async () => {
    const bodies: unknown[] = [];
    const urls: string[] = [];
    let first = true;
    const api = new ApiClient({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
        if (first) {
          first = false;
          return json({ account: { email: 'you@example.com', displayName: null }, csrfToken: 't1' });
        }
        urls.push(String(input));
        bodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : null);
        return String(input).endsWith('/interest') ? json({ interest: { dropId: ID(1), size: { id: ID(12), label: '17' } } }) : json({ entry: { id: ID(9), status: 'WAITING' } });
      }) as typeof fetch,
    });
    await api.me();
    const sizes = [{ piece: 1, sizeId: ID(12) }, { piece: 2, sizeId: ID(21) }, { piece: 3, sizeId: ID(31) }];
    await api.liveInterest(ID(1), sizes);
    await api.liveEnter(ID(1), sizes);
    await api.liveEnter(ID(1), sizes, 2);
    await api.liveSize(ID(1), [{ piece: 2, sizeId: ID(22) }]);
    await api.liveSize(ID(1), sizes, 1);
    await api.liveEnter(ID(1), ID(12));
    expect(bodies).toEqual([{ sizes }, { sizes }, { sizes, quantity: 2 }, { sizes: [{ piece: 2, sizeId: ID(22) }] }, { sizes, quantity: 1 }, { sizeId: ID(12) }]);
    expect(urls.map((u) => u.replace(ID(1), ':id'))).toEqual(['/api/v1/live/:id/interest', '/api/v1/live/:id/enter', '/api/v1/live/:id/enter', '/api/v1/live/:id/size', '/api/v1/live/:id/size', '/api/v1/live/:id/enter']);
  });
});

describe('THE SET\'s LIVE words', () => {
  it('hold to the lexicon', () => {
    const words = JSON.stringify(SETS.live, (_k, v: unknown) => (typeof v === 'function' ? String((v as (...a: unknown[]) => string)(2, ['17', '52'])) : v)) + SETS.live.soldOut.title('HALO', '56') + SETS.live.soldOut.none('HALO', '56');
    expect(findForbidden(words, [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN])).toEqual([]);
  });
});
