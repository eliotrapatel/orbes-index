/**
 * NOW's model (plan NOCTURNE, screen 1, step N3; src/web/verify/now-model.ts), pure: what leads (a LIVE RELEASE with the
 * draw under it, else a draw, else the newest model of the collection, else nothing), each hero's lines as the boards
 * set them (C1, C10, C42, C43), YOUR PIECES by their model's photographs and the tier in one line, THE CIRCLE's next
 * invitation; and the pieces it shares with THE COLLECTION and THE CIRCLE (lookbook-model.ts entryDots, sizesLine,
 * youOwn; circle-model.ts invitationReply).
 */
import { describe, expect, it } from 'vitest';
import { invitationReply } from '../../src/web/verify/circle-model.js';
import { LOOKBOOK, NOW, TIER } from '../../src/web/verify/copy.js';
import { entryDots, sizesLine, youOwn } from '../../src/web/verify/lookbook-model.js';
import { collectionHero, collectionTeaser, drawLead, liveHero, livePhase, newestEntry, nextInvitation, nowPieces, nowTop, tierLine } from '../../src/web/verify/now-model.js';
import type { CircleCard, ClubStatus, DropCard, LiveCard, LookbookCard, OwnedPiece } from '../../src/web/verify/types.js';
import { brandForbiddenTerms, EXTRA_FORBIDDEN_EN, findForbidden } from '../docs/lexicon.js';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MEDIA = (c: string) => `/api/v1/media/${c.repeat(64)}`;

function live(over: Partial<LiveCard> = {}): LiveCard {
  return {
    id: ID(1),
    kind: 'LIVE',
    phase: 'ANNOUNCED',
    revealed: { silhouette: true, name: true, photo: true },
    stages: { silhouetteAt: '2026-10-01T10:00:00Z', nameAt: '2026-10-01T10:00:00Z', photoAt: '2026-10-01T10:00:00Z' },
    reveals: [],
    title: 'MONOLITHE IN BLUE',
    name: 'MONOLITHE',
    variant: 'Blue',
    type: 'BRACELET',
    collection: 'ORBITAL',
    silhouetteUrl: null,
    imageUrl: MEDIA('b'),
    lookbook: 'monolithe-blue',
    announcedAt: '2026-10-01T12:00:00Z',
    roomOpensAt: '2026-10-08T18:55:00Z',
    opensAt: '2026-10-08T19:00:00Z',
    closesAt: '2026-10-08T21:00:00Z',
    priceMinor: 505_000,
    currency: 'EUR',
    quantityLine: '25 pieces',
    perAccount: 1,
    access: { minTier: 1, text: 'owners' },
    surprise: false,
    interest: 5,
    ...over,
  };
}

function draw(over: Partial<DropCard> = {}): DropCard {
  return {
    id: ID(2),
    title: 'MONOLITHE, THE OCTOBER DRAW',
    state: 'OPEN',
    model: { name: 'MONOLITHE', type: 'BRACELET', collection: 'ORBITAL', imageUrl: MEDIA('a'), lookbook: 'monolithe', variant: 'Steel' },
    quantity: 12,
    opensAt: '2026-10-05T10:00:00Z',
    closesAt: '2026-10-11T18:00:00Z',
    earlyAccessHours: 0,
    earlyAccessOpensAt: null,
    earlyAccessOpen: false,
    priceMinor: 420_000,
    currency: 'EUR',
    ...over,
  };
}

const DOTS = [
  { slug: 'monolithe', name: 'MONOLITHE', type: 'BRACELET', label: 'Steel', swatch: '#9D9B96', imageUrl: MEDIA('a'), publishedAt: '2026-08-31T09:20:00Z' },
  { slug: 'monolithe-gold', name: 'MONOLITHE', type: 'BRACELET', label: 'Gold', swatch: '#B88A3A', imageUrl: MEDIA('c'), publishedAt: '2026-08-31T09:00:00Z' },
  { slug: 'monolithe-blue', name: 'MONOLITHE', type: 'BRACELET', label: 'Blue', swatch: '#16224A', imageUrl: MEDIA('b'), publishedAt: '2026-08-31T09:10:00Z' },
];

function entry(over: Partial<LookbookCard> = {}): LookbookCard {
  return {
    slug: 'monolithe',
    name: 'MONOLITHE',
    type: 'BRACELET',
    category: { code: 'J', name: 'Jewelry' },
    collection: 'ORBITAL',
    imageUrl: MEDIA('a'),
    variant: { label: 'Steel', swatch: '#9D9B96' },
    variants: DOTS,
    publishedAt: '2026-08-31T09:20:00Z',
    sizes: ['16', '17', '18'],
    ...over,
  };
}

const piece = (productId: string, lookbook: string | null, variant: string | null, imageUrl: string | null = MEDIA('a')) =>
  ({ productId, model: 'MONOLITHE', modelVariant: variant, type: 'BRACELET', imageUrl, lookbook }) as unknown as OwnedPiece;

describe('NOW: what leads', () => {
  it('a LIVE RELEASE announced, its room open or live leads, the draw under it; else a draw; else the newest model; else nothing', () => {
    expect(nowTop([live()], [draw()], [entry()])).toEqual({ kind: 'live', live: live(), draw: draw() });
    expect(nowTop([live({ phase: 'ROOM' })], [], [entry()])).toMatchObject({ kind: 'live', draw: null });
    expect(nowTop([live({ phase: 'LIVE' })], [], [])).toMatchObject({ kind: 'live' });
    expect(nowTop([], [draw()], [entry()])).toEqual({ kind: 'draw', draw: draw() });
    expect(nowTop([], [draw({ state: 'UPCOMING' })], [])).toMatchObject({ kind: 'draw' });
    // A draw closed, drawn or cancelled leads nothing.
    for (const state of ['CLOSED', 'DRAWN', 'CANCELLED'] as const) expect(nowTop([], [draw({ state })], [entry()]).kind, state).toBe('collection');
    expect(nowTop([], [], [entry()])).toEqual({ kind: 'collection', entry: entry() });
    expect(nowTop([], [], [])).toEqual({ kind: 'none' });
  });

  it('with several of a kind, the first in THE RELEASES\' order leads', () => {
    const second = live({ id: ID(9), title: 'MONOLITHE IN BLACK' });
    expect((nowTop([live(), second], [], []) as { live: LiveCard }).live.id).toBe(ID(1));
    const closed = draw({ id: ID(7), state: 'CLOSED' });
    const soon = draw({ id: ID(8), state: 'UPCOMING' });
    expect((nowTop([], [closed, soon, draw()], []) as { draw: DropCard }).draw.id).toBe(ID(8));
  });

  it('the newest model: the entry last published (a model and its variants once), the first on a tie or without a date', () => {
    const older = entry({ slug: 'aurore', name: 'AURORE', publishedAt: '2026-08-01T09:00:00Z', variants: [] });
    expect(newestEntry([older, entry()])?.slug).toBe('monolithe');
    expect(newestEntry([entry(), entry({ slug: 'zenith', publishedAt: '2026-08-31T09:20:00Z' })])?.slug).toBe('monolithe');
    expect(newestEntry([entry({ publishedAt: null }), older])?.slug).toBe('aurore');
    expect(newestEntry([entry({ slug: 'Not An Address' })])).toBeNull();
  });
});

describe('NOW: the heroes', () => {
  it('a LIVE RELEASE (C1): its title, its lines, its Paris time, its interest; its state and countdown on the server\'s clock', () => {
    const m = liveHero(live(), 'Europe/Paris');
    expect(m).toMatchObject({
      href: `/verify/releases/${ID(1)}`,
      title: 'MONOLITHE IN BLUE',
      model: 'MONOLITHE',
      line: 'BRACELET · ORBITAL',
      when: { paris: 'THURSDAY 8 OCTOBER · 21:00 PARIS', local: null },
      lines: ['25 PIECES', 'ONE PER COLLECTOR', 'FOR OWNERS'],
      interest: '5 COLLECTORS WILL BE THERE',
      picture: { src: MEDIA('b'), kind: 'photo' },
    });
    expect(liveHero(live(), 'America/New_York').when.local).toBe('THURSDAY 8 OCTOBER · 15:00 ON THIS PHONE');
    // Before its name's stage: TO BE REVEALED, no line; nobody there yet: no count.
    expect(liveHero(live({ title: null, name: null, interest: 0 }), 'Europe/Paris')).toMatchObject({ title: 'TO BE REVEALED', model: null, line: null, interest: null });
    expect(liveHero(live({ title: null }), 'Europe/Paris').title).toBe('MONOLITHE IN BLUE');

    const h = liveHero(live(), 'Europe/Paris');
    const at = (iso: string) => Date.parse(iso);
    expect(livePhase(h, at('2026-10-05T16:49:00Z'))).toEqual({
      kind: 'LIVE RELEASE',
      countdown: [
        { value: '03', unit: 'DAYS' },
        { value: '02', unit: 'HOURS' },
        { value: '11', unit: 'MINUTES' },
      ],
      ended: false,
    });
    expect(livePhase(h, at('2026-10-08T18:57:00Z'))).toMatchObject({ kind: 'LIVE RELEASE · THE ROOM IS OPEN', countdown: [{ value: '00' }, { value: '03' }, { value: '00' }] });
    expect(livePhase(h, at('2026-10-08T19:30:00Z'))).toEqual({ kind: 'LIVE RELEASE · LIVE NOW', countdown: null, ended: false });
    expect(livePhase(h, at('2026-10-08T21:00:00Z')).ended).toBe(true);
  });

  it('a draw (C42 and its card in C1): its state, title, model, price, pieces and time in UTC never parted, then on this phone', () => {
    expect(drawLead(draw(), 120)).toEqual({
      id: ID(2),
      href: `/verify/releases/${ID(2)}`,
      kind: 'DRAW · ENTRIES OPEN',
      title: 'MONOLITHE, THE OCTOBER DRAW',
      model: 'MONOLITHE · BRACELET',
      price: '€ 4 200',
      line: { lead: '12 PIECES · ENTRIES CLOSE', time: '11 OCT 2026 · 18:00 UTC' },
      local: '11 OCT 2026 · 20:00 on this phone (UTC+02:00)',
      image: { src: MEDIA('a'), alt: 'The model of MONOLITHE, THE OCTOBER DRAW, photographed by ORBES' },
    });
    // Before entries open: ENTRIES OPEN SOON and its opening; in its early access: EARLY ACCESS; no price: none said.
    expect(drawLead(draw({ state: 'UPCOMING', opensAt: '2026-10-07T10:00:00Z' }), 0)).toMatchObject({
      kind: 'DRAW · ENTRIES OPEN SOON',
      line: { lead: '12 PIECES · ENTRIES OPEN', time: '7 OCT 2026 · 10:00 UTC' },
      local: null,
    });
    expect(drawLead(draw({ state: 'UPCOMING', earlyAccessOpensAt: '2026-10-04T10:00:00Z', earlyAccessOpen: true }), 0)?.kind).toBe('DRAW · EARLY ACCESS');
    expect(drawLead(draw({ priceMinor: null, currency: null }), 0)?.price).toBeNull();
    expect(drawLead(draw({ id: 'nope' }), 0)).toBeNull();
  });

  it('the newest model (C43): THE COLLECTION · its collection, its sizes, its dots, what the account owns of it', () => {
    const owned = [piece('O26-J-00184', 'monolithe', 'Steel'), piece('O26-J-00199', 'monolithe-gold', 'Gold')];
    expect(collectionHero(entry(), owned)).toMatchObject({
      slug: 'monolithe',
      label: 'THE COLLECTION · ORBITAL',
      name: 'MONOLITHE',
      type: 'BRACELET',
      sizes: 'SIZES 16 · 17 · 18',
      owned: 'You own two: steel and gold',
      image: { src: MEDIA('a'), alt: 'The MONOLITHE BRACELET model in steel, photographed by ORBES' },
    });
    expect(collectionHero(entry(), owned).dots.map((d) => d.label)).toEqual(['Steel', 'Gold', 'Blue']);
    expect(collectionHero(entry({ collection: null, sizes: [] }), [])).toMatchObject({ label: 'THE COLLECTION', sizes: null, owned: null });
  });

  it('THE COLLECTION under the hero: the newest entry by a photograph the hero does not show, its first published', () => {
    // The hero shows blue (C1): of steel and gold, gold was shown first.
    expect(collectionTeaser(entry(), 'monolithe-blue')).toEqual({ collection: 'ORBITAL', name: 'MONOLITHE', type: 'BRACELET', image: { src: MEDIA('c'), alt: 'The MONOLITHE BRACELET model in gold, photographed by ORBES' } });
    // The hero shows steel (C42): gold again.
    expect(collectionTeaser(entry(), 'monolithe').image?.src).toBe(MEDIA('c'));
    // A model alone: its own photograph.
    expect(collectionTeaser(entry({ variants: [] }), 'monolithe').image?.src).toBe(MEDIA('a'));
  });
});

describe('NOW: an owner\'s sections', () => {
  it('YOUR PIECES: the first two, by their model\'s photograph, named after the model and its variant (decision 9)', () => {
    const pieces = [piece('O26-J-00184', 'monolithe', 'Steel'), piece('O26-J-00199', 'monolithe-gold', 'Gold', MEDIA('c')), piece('O26-J-00200', null, null)];
    expect(nowPieces(pieces)).toEqual([
      { productId: 'O26-J-00184', name: 'MONOLITHE', image: { src: MEDIA('a'), alt: 'The MONOLITHE BRACELET model in steel, photographed by ORBES' } },
      { productId: 'O26-J-00199', name: 'MONOLITHE', image: { src: MEDIA('c'), alt: 'The MONOLITHE BRACELET model in gold, photographed by ORBES' } },
    ]);
    expect(nowPieces([piece('O26-J-00300', null, null, 'https://elsewhere.example/a.jpg')])[0]!.image).toBeNull();
  });

  it('the tier in one line (decision 10: its whole block is the account sheet\'s)', () => {
    const status = (level: 0 | 1 | 2 | 3, pieces: number, next: ClubStatus['next']) => ({ tier: { level, name: null }, pieces, next }) as unknown as ClubStatus;
    expect(tierLine(status(1, 2, { level: 2, name: 'PLATINE', pieces: 3, missing: 1, benefits: [] } as never))).toEqual({
      name: 'TITANE',
      text: '2 pieces held. 1 more piece registered to your account opens PLATINE, from 3 pieces held.',
    });
    expect(tierLine(status(3, 6, null))).toEqual({ name: 'PALLADIUM', text: `6 pieces held. ${TIER.top}` });
    expect(tierLine(status(0, 0, { level: 1, name: 'TITANE', pieces: 1, missing: 1, benefits: [] } as never))).toEqual({
      name: 'THE CLUB',
      text: 'A piece registered to your ORBES account opens TITANE, the first tier of the club.',
    });
    expect(tierLine(null)).toBeNull();
    // MY PIECES' sentence is unchanged.
    expect(TIER.nextWay('PLATINE', 1, 3)).toBe('1 more piece registered to your account opens PLATINE, from 3 pieces held. It adds:');
    expect(TIER.first('TITANE')).toBe('A piece registered to your ORBES account opens TITANE, the first tier of the club:');
  });

  it('THE CIRCLE: the next invitation whose answers are open, its places and the answer given (addition 6)', () => {
    const card = (n: number, over: Partial<CircleCard>): CircleCard => ({
      id: ID(n),
      kind: 'INVITATION',
      title: `POST ${n}`,
      minTier: 1,
      publishedAt: '2026-10-03T10:00:00Z',
      cover: null,
      eventAt: '2026-10-12T17:00:00Z',
      eventPlace: 'PARIS',
      answer: null,
      voted: false,
      invitation: { capacity: 12, placesLeft: 3, open: true },
      ...over,
    });
    const now = Date.parse('2026-10-05T16:49:00Z');
    const later = card(1, { eventAt: '2026-10-20T17:00:00Z' });
    const next = card(2, { answer: 'YES' });
    const begun = card(3, { eventAt: '2026-10-04T17:00:00Z', invitation: { capacity: 12, placesLeft: 3, open: false } });
    const note = card(4, { kind: 'NOTE', eventAt: null, invitation: null });
    const m = nextInvitation([later, note, begun, next], now)!;
    expect(m).toMatchObject({ id: ID(2), kindLabel: 'INVITATION', date: '3 OCT 2026', event: '12 OCT 2026 · 17:00 UTC · PARIS', linkLabel: 'SEE THE INVITATION' });
    expect(m.reply).toEqual({ places: '3 LEFT OF 12', answer: 'YES', open: true, full: false });
    expect(nextInvitation([note, begun], now)).toBeNull();
    // Every place taken by others: YES held back; none left for the reader who said YES: still theirs.
    expect(invitationReply({ capacity: 12, placesLeft: 0, open: true }, null)).toEqual({ places: 'NONE LEFT OF 12', answer: null, open: true, full: true });
    expect(invitationReply({ capacity: 12, placesLeft: 0, open: true }, 'YES')?.full).toBe(false);
    expect(invitationReply({ capacity: null, placesLeft: null, open: true }, 'NO')).toEqual({ places: null, answer: 'NO', open: true, full: false });
    expect(invitationReply(null, 'YES')).toBeNull();
  });
});

describe('NOW: the collection\'s pieces it shares (reused by THE COLLECTION)', () => {
  it('an entry\'s dots, its sizes, and « You own N » across its variants', () => {
    expect(entryDots(entry()).map((d) => [d.slug, d.label, d.publishedAt])).toEqual([
      ['monolithe', 'Steel', Date.parse('2026-08-31T09:20:00Z')],
      ['monolithe-gold', 'Gold', Date.parse('2026-08-31T09:00:00Z')],
      ['monolithe-blue', 'Blue', Date.parse('2026-08-31T09:10:00Z')],
    ]);
    expect(entryDots(entry({ variants: [DOTS[0]!] }))).toEqual([]);
    expect(sizesLine(['16', '17', '18'])).toBe('SIZES 16 · 17 · 18');
    expect(sizesLine(['17'])).toBe('SIZE 17');
    expect(sizesLine([])).toBeNull();
    expect(sizesLine(undefined)).toBeNull();
    const steel = piece('a', 'monolithe', 'Steel');
    const gold = piece('b', 'monolithe-gold', 'Gold');
    expect(youOwn(entry(), [steel, gold])).toBe('You own two: steel and gold');
    expect(youOwn(entry(), [steel, steel, gold, piece('c', 'monolithe-blue', 'Blue')])).toBe('You own four: steel, gold and blue');
    expect(youOwn(entry(), [steel])).toBe('You own one: steel');
    expect(youOwn(entry(), [piece('d', 'aurore', null)])).toBeNull();
    expect(youOwn(entry({ slug: 'aurore', variants: [] }), [piece('d', 'aurore', null)])).toBe('You own one');
    expect(LOOKBOOK.youOwn(13)).toBe('You own 13');
  });

  it('writes no word of the brand\'s forbidden lexicon, and no exclamation mark', () => {
    const lines = [...Object.values(NOW.sections), NOW.label, NOW.draw, NOW.pieces, NOW.scan, NOW.upload, LOOKBOOK.sizes('16'), LOOKBOOK.variants, LOOKBOOK.youOwn(2, 'steel', 'gold'), TIER.way('PLATINE', 1, 3), TIER.firstWay('TITANE')];
    expect(findForbidden(lines.join('\n'), [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN])).toEqual([]);
    expect(lines.join('\n')).not.toMatch(/!/);
  });
});
