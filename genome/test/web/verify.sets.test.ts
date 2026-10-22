/**
 * THE SET on the collector's side (macro scope of 2026-10-20, K44 T1 to T3; plan MACRO M3 §5.4, step M3.18), pure: a set's
 * release in THE RELEASES, NOW and PAST (THE SET · 3 PIECES, its pieces' photographs side by side from the photograph's
 * stage, their names from the name's, 1 SET PER PERSON); a set's draw (ONE PRICE FOR THE SET, its sets, each piece's
 * sizes, a picker per piece preselected from the entry, YOUR SIZES or the only size, ENTER THE DRAW once every piece has a
 * size, every size on the entry's label and the list's line, its own rule); YOUR ORDERS (a set's pieces grouped under
 * THE SET · <name> with its one price and total, PART OF THE SET on each piece, RETURN THE SET, the set cancelled whole);
 * and the club's bodies with a size per piece. The screens are driven in Chromium by the content states (set-*).
 */
import { describe, expect, it } from 'vitest';
import { ApiClient } from '../../src/web/verify/api.js';
import { LIVE, ORDERS, RELEASES, SETS } from '../../src/web/verify/copy.js';
import { formatMoney, liveCards } from '../../src/web/verify/live-model.js';
import { drawLead, liveHero } from '../../src/web/verify/now-model.js';
import { orderGroups, orderModels, orderRequest, orderReturns, orderSentence } from '../../src/web/verify/orders-model.js';
import { drawLines, entryModel, entrySizes, pastCards, releaseCards, releaseSheet, setCard, setChoice, setPick, setPickNote, setPieces } from '../../src/web/verify/releases-model.js';
import type { AccountOrder, DropCard, DropSheet, LiveCard, PastRelease } from '../../src/web/verify/types.js';
import { brandForbiddenTerms, EXTRA_FORBIDDEN_EN, findForbidden } from '../docs/lexicon.js';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MEDIA = (c: string) => `/api/v1/media/${c.repeat(64)}`;
const PIECES = [
  { piece: 1, name: 'MONOLITHE', type: 'BRACELET', collection: 'ORBITAL', imageUrl: MEDIA('a'), lookbook: null, variant: 'Gold' },
  { piece: 2, name: 'HALO', type: 'RING', collection: null, imageUrl: MEDIA('b'), lookbook: null, variant: null },
  { piece: 3, name: 'CONSTELLATION ORBITALE', type: 'NECKLACE', collection: null, imageUrl: MEDIA('c'), lookbook: null, variant: null },
];

function setCardOf(extra: Partial<DropCard> = {}): DropCard {
  return {
    id: ID(1),
    title: 'THE ORBITAL SET, THE OCTOBER DRAW',
    state: 'OPEN',
    model: { name: 'THE ORBITAL SET', type: 'SET', collection: null, imageUrl: null, lookbook: null, variant: null },
    quantity: 6,
    opensAt: '2026-10-03T10:00:00.000Z',
    closesAt: '2026-10-09T18:00:00.000Z',
    earlyAccessHours: 0,
    earlyAccessOpensAt: null,
    earlyAccessOpen: false,
    priceMinor: 1_200_000,
    currency: 'EUR',
    set: { name: 'THE ORBITAL SET', pieces: PIECES },
    ...extra,
  };
}

const SIZES = [
  { id: ID(11), piece: 1, label: '16', pieces: 2, reserved: 0, full: false },
  { id: ID(12), piece: 1, label: '17', pieces: 4, reserved: 0, full: false },
  { id: ID(21), piece: 2, label: '52', pieces: 3, reserved: 0, full: false },
  { id: ID(22), piece: 2, label: '56', pieces: 1, reserved: 1, full: true },
  { id: ID(31), piece: 3, label: '45', pieces: 6, reserved: 0, full: false },
];

function setSheet(extra: Partial<DropSheet> = {}): DropSheet {
  return {
    ...setCardOf(),
    description: null,
    purchaseWindowHours: 72,
    publishedAt: '2026-10-01T10:00:00.000Z',
    cancelledAt: null,
    drawnAt: null,
    seedHash: 'ab'.repeat(32),
    seed: null,
    reserved: 0,
    sizes: SIZES,
    ...extra,
  };
}

describe('THE SET in THE RELEASES, NOW and PAST (K44 T1)', () => {
  it('a set\'s draw card: THE SET · 3 PIECES, its pieces\' names and photographs side by side, its quantity in sets, its set\'s name begins its title', () => {
    const [c] = releaseCards([setCardOf()]);
    expect(c!.model).toBe('THE SET · 3 PIECES');
    expect(c!.image).toBeNull();
    expect(c!.set).toEqual({
      line: 'THE SET · 3 PIECES',
      names: 'MONOLITHE IN GOLD · HALO · CONSTELLATION ORBITALE',
      images: [
        { src: MEDIA('a'), alt: SETS.photoLabel('MONOLITHE IN GOLD') },
        { src: MEDIA('b'), alt: SETS.photoLabel('HALO') },
        { src: MEDIA('c'), alt: SETS.photoLabel('CONSTELLATION ORBITALE') },
      ],
    });
    expect(c!.titleName).toBe('THE ORBITAL SET');
    expect(c!.line).toBe('6 SETS · ENTRIES CLOSE 9 OCT 2026 · 18:00 UTC');
    // A model's card reads as before.
    const [m] = releaseCards([setCardOf({ set: undefined, model: { name: 'Halo', type: 'Ring', collection: null, imageUrl: MEDIA('d'), lookbook: null } })]);
    expect([m!.set, m!.model, m!.line.split(' · ')[0]]).toEqual([null, 'HALO · RING', '6 PIECES']);
  });

  it('setCard: names only once every piece is named, photographs only those the server gives, nothing for fewer than two pieces', () => {
    const veiled = setCard([
      { name: null, variant: null, imageUrl: null },
      { name: null, variant: null, imageUrl: null },
    ]);
    expect(veiled).toEqual({ line: 'THE SET · 2 PIECES', names: null, images: [] });
    expect(setCard([{ name: 'HALO', variant: null, imageUrl: 'https://elsewhere.example/a.jpg' }, { name: 'LINEA', variant: null, imageUrl: MEDIA('e') }])!.images).toEqual([{ src: MEDIA('e'), alt: SETS.photoLabel('LINEA') }]);
    expect(setCard([{ name: 'HALO', variant: null, imageUrl: null }])).toBeNull();
  });

  it('a set\'s LIVE RELEASE: its pieces at their stages, 1 SET PER PERSON (T4); NOW leads with them', () => {
    const base: LiveCard = {
      id: ID(2),
      kind: 'LIVE',
      phase: 'ANNOUNCED',
      revealed: { silhouette: true, name: true, photo: true },
      stages: { silhouetteAt: '2026-10-01T10:00:00Z', nameAt: '2026-10-02T10:00:00Z', photoAt: '2026-10-03T10:00:00Z' },
      reveals: [],
      title: 'THE ORBITAL SET, RELEASED LIVE',
      name: 'THE ORBITAL SET',
      variant: null,
      type: 'SET',
      collection: null,
      silhouetteUrl: null,
      imageUrl: null,
      lookbook: null,
      announcedAt: '2026-10-01T10:00:00Z',
      roomOpensAt: '2026-10-07T18:55:00Z',
      opensAt: '2026-10-07T19:00:00Z',
      closesAt: '2026-10-07T20:00:00Z',
      priceMinor: 1_200_000,
      currency: 'EUR',
      quantityLine: '12 SETS',
      perAccount: 1,
      access: { minTier: 1, text: 'owners' },
      surprise: false,
      interest: 0,
      set: { name: 'THE ORBITAL SET', pieces: PIECES.map((p) => ({ piece: p.piece, name: p.name, variant: p.variant, type: p.type, collection: p.collection, imageUrl: p.imageUrl, lookbook: null })) },
    };
    const [c] = liveCards([base], 'Europe/Paris');
    expect(c!.set!.images).toHaveLength(3);
    expect(c!.set!.names).toBe('MONOLITHE IN GOLD · HALO · CONSTELLATION ORBITALE');
    expect(c!.lines).toEqual(['12 SETS', '1 SET PER PERSON', LIVE.forWhom('owners')]);
    expect(liveCards([{ ...base, perAccount: 2 }], 'Europe/Paris')[0]!.lines[1]).toBe('UP TO 2 SETS PER PERSON');
    // Before the name's stage: the line alone, no name, no photograph.
    const veiled = { ...base, revealed: { silhouette: false, name: false, photo: false }, title: null, name: null, set: { name: null, pieces: base.set!.pieces.map((p) => ({ ...p, name: null, variant: null, imageUrl: null })) } };
    expect(liveCards([veiled], 'Europe/Paris')[0]!.set).toEqual({ line: 'THE SET · 3 PIECES', names: null, images: [] });
    const hero = liveHero(base, 'Europe/Paris');
    expect([hero.line, hero.set!.images.length, hero.lines[1]]).toEqual(['THE SET · 3 PIECES', 3, '1 SET PER PERSON']);
    const lead = drawLead(setCardOf(), 0)!;
    expect([lead.model, lead.titleName, lead.line.lead, lead.set!.names]).toEqual(['THE SET · 3 PIECES', 'THE ORBITAL SET', '6 SETS · ENTRIES CLOSE', 'MONOLITHE IN GOLD · HALO · CONSTELLATION ORBITALE']);
  });

  it('PAST: a set\'s release under its set\'s name (a LIVE RELEASE\'s from its name\'s stage), its pieces, its quantity in sets', () => {
    const item = (extra: Partial<PastRelease>): PastRelease => ({
      id: ID(3),
      kind: 'DRAW',
      title: 'THE ORBITAL SET, IN SEPTEMBER',
      model: { name: null, type: null, collection: null, variant: null },
      imageUrl: null,
      opensAt: '2026-09-02T10:00:00Z',
      quantityLine: '2 SETS',
      set: { name: 'THE ORBITAL SET', pieces: PIECES.map((p) => ({ name: p.name, variant: p.variant, imageUrl: p.imageUrl })) },
      ...extra,
    });
    const [draw, live, early] = pastCards(
      [item({}), item({ id: ID(4), kind: 'LIVE', title: 'X' }), item({ id: ID(5), kind: 'LIVE', title: null, set: { name: null, pieces: PIECES.map(() => ({ name: null, variant: null, imageUrl: null })) } })],
      'Europe/Paris',
    );
    expect([draw!.title, draw!.model, draw!.pieces, draw!.set!.images.length]).toEqual(['THE ORBITAL SET, IN SEPTEMBER', 'MONOLITHE IN GOLD · HALO · CONSTELLATION ORBITALE', '2 SETS', 3]);
    expect(live!.title).toBe('THE ORBITAL SET');
    expect([early!.title, early!.model, early!.set!.line]).toEqual([RELEASES.past.kind.LIVE, '', 'THE SET · 3 PIECES']);
  });
});

describe('a set\'s draw page (K44 T1)', () => {
  it('its facts: ONE PRICE FOR THE SET, SETS, each piece\'s name over its sizes, the sets reserved directly, its own rule; its pieces as its model line, their photographs side by side', () => {
    const s = releaseSheet(setSheet({ earlyAccessHours: 24, earlyAccessOpensAt: '2026-10-02T10:00:00.000Z', earlyAccessOpen: false, reserved: 1 }), 0);
    expect(s.eyebrow).toBe('THE SET · 3 PIECES');
    expect(s.model).toBe('MONOLITHE IN GOLD · HALO · CONSTELLATION ORBITALE');
    expect(s.image).toBeNull();
    expect(s.lookbookSlug).toBeNull();
    expect(s.rule).toBe(SETS.rule);
    expect(s.set!.images.map((i) => i.src)).toEqual([MEDIA('a'), MEDIA('b'), MEDIA('c')]);
    const row = (label: string) => s.rows.find((r) => r.label === label);
    expect(row(RELEASES.rows.price)).toEqual({ label: 'PRICE', value: formatMoney(1_200_000, 'EUR'), note: SETS.onePrice });
    expect(row(SETS.rows.sets)!.value).toBe('6');
    expect(row(RELEASES.rows.pieces)).toBeUndefined();
    expect(row(RELEASES.rows.sizes)!.groups).toEqual([
      { head: 'MONOLITHE IN GOLD', lines: ['SIZE 16 · 2 PIECES', 'SIZE 17 · 4 PIECES'] },
      { head: 'HALO', lines: ['SIZE 52 · 3 PIECES', 'SIZE 56 · 1 PIECE · 1 RESERVED DIRECTLY · FULL'] },
      { head: 'CONSTELLATION ORBITALE', lines: ['SIZE 45 · 6 PIECES'] },
    ]);
    expect(row(RELEASES.rows.reserved)!.value).toBe('1 OF 6 SETS');
  });

  it('a picker per piece, preselected from the entry, else YOUR SIZES for that piece, else its only size; ENTER waits until every piece has a size', () => {
    const pieces = setPieces(setSheet());
    expect(pieces.map((p) => [p.piece, p.name, p.line, p.sizes.length])).toEqual([
      [1, 'MONOLITHE IN GOLD', 'MONOLITHE IN GOLD · BRACELET', 2],
      [2, 'HALO', 'HALO · RING', 2],
      [3, 'CONSTELLATION ORBITALE', 'CONSTELLATION ORBITALE · NECKLACE', 1],
    ]);
    const saved = [{ piece: 1, id: ID(12), label: '17' }, { piece: 2, id: 'not-a-size', label: '58' }];
    const picks = setPick(pieces, null, saved);
    expect([...picks.entries()]).toEqual([
      [1, { sizeId: ID(12), from: 'saved' }],
      [3, { sizeId: ID(31), from: 'only' }],
    ]);
    expect(setChoice(pieces, picks)).toBeNull();
    picks.set(2, { sizeId: ID(22), from: 'only' });
    expect(setChoice(pieces, picks)).toEqual([
      { piece: 1, sizeId: ID(12) },
      { piece: 2, sizeId: ID(22) },
      { piece: 3, sizeId: ID(31) },
    ]);
    // A size of another piece is never sent for this one.
    expect(setChoice(pieces, new Map([...picks, [2, { sizeId: ID(11), from: 'only' as const }]]))).toBeNull();
    // The entry's own sizes first.
    const entry = { sizes: [{ piece: 1, id: ID(11), label: '16' }, { piece: 2, id: ID(21), label: '52' }, { piece: 3, id: ID(31), label: '45' }] };
    expect(setPick(pieces, entry, saved).get(1)).toEqual({ sizeId: ID(11), from: 'entry' });
    // HALO 56, every piece reserved, said under it while entries are open.
    expect(setPickNote(pieces[1]!, ID(22), 'OPEN')).toBe(SETS.openFull('56', 'HALO'));
    expect(setPickNote(pieces[1]!, ID(22), 'UPCOMING')).toBeNull();
    expect(setPickNote(pieces[1]!, ID(21), 'OPEN')).toBeNull();
  });

  it('an entry\'s every size on its label and the list\'s line, in the set\'s order; its sentence while entries are open', () => {
    const sizes = [{ piece: 3, id: ID(31), label: '45' }, { piece: 1, id: ID(12), label: '17' }, { piece: 2, id: ID(21), label: '52' }];
    expect(entrySizes({ sizes })).toEqual(['17', '52', '45']);
    const release = { id: ID(1), title: 'THE ORBITAL SET, THE OCTOBER DRAW', state: 'OPEN' as const, opensAt: '2026-10-03T10:00:00.000Z' };
    const entered = entryModel(release, { id: ID(9), status: 'ENTERED', rank: null, respondBy: null, size: null, sizes }, { offsetMinutes: 0 });
    expect([entered.label, entered.sentence, entered.canWithdraw]).toEqual(['ENTERED · SIZE 17 · 52 · 45', SETS.entered, true]);
    const held = entryModel({ ...release, state: 'DRAWN' }, { id: ID(9), status: 'SELECTED', rank: 1, respondBy: '2026-10-07T18:01:00.000Z', size: null, sizes }, { offsetMinutes: 0 });
    expect(held.label).toBe('PLACE HELD · SIZE 17 · 52 · 45');
    const waiting = entryModel({ ...release, state: 'DRAWN' }, { id: ID(9), status: 'WAITLISTED', rank: 3, respondBy: null, size: null, sizes }, { offsetMinutes: 0 });
    expect([waiting.label, waiting.sentence]).toEqual(['WAITING LIST · SIZE 17 · 52 · 45', RELEASES.status.waitlisted(3)]);
    expect(drawLines([{ id: ID(9), tier: 1, seniority: 0, rank: 2, size: null, sizes }], ID(9))[0]!.line).toBe('2 · TITANE · 0 YEARS · SIZE 17 · 52 · 45');
    expect(SETS.label('ENTERED', ['ONE SIZE', '52'])).toBe('ENTERED · ONE SIZE · 52');
  });
});

describe('YOUR ORDERS with a set (K44 T1 to T3)', () => {
  const SALE = ID(100);
  const set = (piece: number, pieces: string[], extra: Partial<NonNullable<AccountOrder['set']>> = {}) => ({ saleId: SALE, name: 'The Orbital Set', priceMinor: 1_200_000, currency: 'EUR', piece, pieces, ...extra });
  const order = (n: number, extra: Partial<AccountOrder> = {}): AccountOrder => ({
    id: ID(n),
    reference: `OR-0000000${n}`,
    channel: 'DRAW',
    release: 'The Orbital Set, in September',
    model: 'Halo',
    size: { label: '52' },
    priceMinor: 400_000,
    currency: 'EUR',
    addons: [],
    status: 'DELIVERED',
    reservedAt: '2026-09-05T09:00:00.000Z',
    paidAt: '2026-09-20T10:00:00.000Z',
    shippedAt: '2026-09-26T10:00:00.000Z',
    deliveredAt: '2026-09-28T15:00:00.000Z',
    cancelledAt: null,
    returnedAt: null,
    shipment: null,
    ...extra,
  });
  const ids = [ID(1), ID(2), ID(4), ID(3)];
  const list = [
    order(9, { set: null, model: 'Zenith', channel: 'SALON', release: null }),
    order(3, { set: set(3, ids), model: 'Constellation Orbitale', size: { label: '45' } }),
    order(1, { set: set(1, ids), model: 'Monolithe', size: { label: '17' } }),
    order(2, { set: set(2, ids), status: 'RETURNED', returnedAt: '2026-10-01T10:00:00.000Z' }),
    order(4, { set: set(2, ids), channel: 'EXCHANGE', size: { label: '54' }, status: 'PAID', shippedAt: null, deliveredAt: null, engraving: { text: 'C.L.', priceMinor: 3_000 } }),
  ];

  it('groups a set\'s pieces where its first comes, in the set\'s order, under THE SET · <name> with its one price and its total', () => {
    const groups = orderGroups(orderModels(list, 0));
    expect(groups.map((g) => g.kind)).toEqual(['order', 'set']);
    const g = groups[1] as Extract<(typeof groups)[number], { kind: 'set' }>;
    expect(g.orders.map((m) => m.id)).toEqual(ids);
    expect(g.set).toMatchObject({
      saleId: SALE,
      name: 'THE ORBITAL SET',
      heading: 'THE SET · THE ORBITAL SET',
      count: '3 PIECES',
      price: formatMoney(1_200_000, 'EUR'),
      // The exchanged piece's priced engraving adds to the set's price.
      total: formatMoney(1_203_000, 'EUR'),
    });
    expect(g.set.pieces.map((p) => [p.reference, p.size])).toEqual([
      ['OR-00000001', 'SIZE 17'],
      ['OR-00000002', 'SIZE 52'],
      ['OR-00000004', 'SIZE 54'],
      ['OR-00000003', 'SIZE 45'],
    ]);
    const first = g.orders[0]!;
    expect(first.set!.pieceLine).toBe('PIECE 1 OF 3');
    // Each piece: PART OF THE SET in its PRICE row, never its share, and no TOTAL of its own.
    expect(first.rows).toEqual([
      [ORDERS.rows.size, '17'],
      [ORDERS.rows.price, SETS.orders.inSet],
    ]);
    expect(g.orders[2]!.rows.map(([k]) => k)).not.toContain(ORDERS.rows.total);
    // An order of its own reads as before.
    expect((groups[0] as Extract<(typeof groups)[number], { kind: 'order' }>).order.set).toBeNull();
  });

  it('RETURN THE SET in place of REQUEST A RETURN, and why; once asked, every piece sent back together; the set cancelled whole', () => {
    const delivered = { ...list[2]!, returnable: { until: '2026-10-12T15:00:00.000Z', sizes: [{ label: '16', available: true }], savedSize: null } };
    const r = orderReturns(delivered, 0)!;
    expect([r.set, r.lead]).toEqual([true, SETS.orders.lead('12 OCT 2026')]);
    expect(orderReturns({ ...delivered, set: null }, 0)!.set).toBe(false);
    const asked = { ...delivered, returnable: null, case: { kind: 'RETURN' as const, status: 'OPEN' as const, openedAt: '2026-10-05T10:00:00.000Z', receivedAt: null, sizeLabel: null, returnAddress: 'ORBES LOGISTICS\n93400 Saint-Ouen', outcome: null, exchangeOrder: null } };
    expect(orderRequest(asked, 0)!.sentences).toEqual([SETS.orders.sendTogether, ORDERS.returns.sendBack('OR-00000001')]);
    expect(orderRequest({ ...asked, set: null }, 0)!.sentences).toEqual([ORDERS.returns.sendBack('OR-00000001')]);
    expect(orderSentence({ ...list[2]!, status: 'CANCELLED' })).toBe(SETS.orders.cancelled);
    // A piece's size exchange cancelled alone is not the set's.
    expect(orderSentence({ ...list[4]!, status: 'CANCELLED' })).toBe(ORDERS.sentence.CANCELLED);
    // A set without its price entered yet: TO BE CONFIRMED.
    const unpriced = orderModels([{ ...list[2]!, set: set(1, ids, { priceMinor: null, currency: null }) }], 0)[0]!;
    expect([unpriced.set!.price, unpriced.set!.total]).toEqual([ORDERS.toConfirm, null]);
  });
});

describe('the club\'s bodies of a set\'s draw (K44 T1)', () => {
  it('ENTER, RESERVE and CHANGE SIZE send `sizes` (a size per piece); a model\'s draw its `sizeId`', async () => {
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
        return json({ entry: { id: ID(9) } });
      }) as typeof fetch,
    });
    await api.me();
    const sizes = [{ piece: 1, sizeId: ID(12) }, { piece: 2, sizeId: ID(21) }];
    await api.enterDrop(ID(1), sizes);
    await api.reserveDrop(ID(1), sizes);
    await api.changeDrawSize(ID(1), [{ piece: 2, sizeId: ID(22) }]);
    await api.enterDrop(ID(1), ID(12));
    await api.enterDrop(ID(1), null);
    expect(bodies).toEqual([{ sizes }, { sizes }, { sizes: [{ piece: 2, sizeId: ID(22) }] }, { sizeId: ID(12) }, null]);
    expect(urls.map((u) => u.replace(ID(1), ':id'))).toEqual(['/api/v1/club/drops/:id/enter', '/api/v1/club/drops/:id/reserve', '/api/v1/club/drops/:id/size', '/api/v1/club/drops/:id/enter', '/api/v1/club/drops/:id/enter']);
  });
});

describe('THE SET\'s words', () => {
  it('hold to the lexicon', () => {
    const words = JSON.stringify(SETS, (_k, v: unknown) => (typeof v === 'function' ? String((v as (...a: unknown[]) => string)(3, ['17', '52'])) : v)) + SETS.label('ENTERED', ['17', '52']) + SETS.openFull('56', 'HALO');
    expect(findForbidden(words, [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN])).toEqual([]);
  });
});
