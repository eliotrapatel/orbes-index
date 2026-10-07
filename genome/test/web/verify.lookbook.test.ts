/**
 * THE COLLECTION (P-R02): the lookbook's grid and sheets as /verify shows them (lookbook-model.ts), the words both
 * apps draw from a sheet (shared/lookbook.ts: the story's paragraphs, the specifications' rows, what the console says
 * before it sends them), held to the server's own rules (services/lookbook.ts), the copy held to the lexicon, and SEE
 * THE MODEL under an authentic result. Pure: no DOM. The pages are driven in Chromium by verify.e2e.test.ts and the
 * console's by admin.e2e.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  lookbookNotFound,
  normalizePriceLabel,
  normalizeSpecs,
  normalizeStory,
  parseSpecs,
  PRICE_LABEL_MAX as SERVER_PRICE_LABEL_MAX,
  SLUG_MAX,
  SLUG_RE,
  SPEC_LABEL_MAX,
  SPECS_MAX,
  STORY_MAX,
} from '../../src/server/services/lookbook.js';
import { SHOP_NOTE_MAX, SHOP_RESOLUTION_MAX } from '../../src/server/services/salon.js';
import { CLUB_TIER_NAMES as SERVER_TIER_NAMES } from '../../src/server/db/schema.js';
import { canCloseRequest, closeRequestProblem, requestModelLine, SHOP_REQUEST_LIMITS, SHOP_REQUEST_OUTCOME_OPTIONS, shopRequestStatusOf } from '../../src/web/admin/model/club.js';
import { SHOP_REQUEST_OUTCOMES } from '../../src/web/admin/types.js';
import { GALLERY_ALT_MAX as SERVER_GALLERY_ALT_MAX, GALLERY_MAX as SERVER_GALLERY_MAX } from '../../src/server/services/media.js';
import { DomainError } from '../../src/server/errors.js';
import {
  defaultAlt,
  GALLERY_ALT_MAX,
  GALLERY_MAX,
  galleryMoved,
  galleryOrder,
  galleryWithAlt,
  PRICE_LABEL_MAX,
  proposeSlug,
  publicationChange,
  publicationForm,
  publicationProblem,
  SALON_TIER_OPTIONS,
  salonChange,
  salonForm,
  salonImpact,
  salonProblem,
  salonTierName,
} from '../../src/web/admin/model/lookbook.js';
import type { Model } from '../../src/web/admin/types.js';
import {
  isLookbookSlug,
  LOOKBOOK_SLUG_MAX,
  LOOKBOOK_SLUG_RE,
  LOOKBOOK_SPEC_LABEL_MAX,
  LOOKBOOK_SPECS_MAX,
  LOOKBOOK_STORY_MAX,
  specRows,
  specsProblem,
  storyParagraphs,
} from '../../src/web/shared/lookbook.js';
import * as verifyCopy from '../../src/web/verify/copy.js';
import { DEFAULT_CARE, LOOKBOOK, PHOTOS } from '../../src/web/verify/copy.js';
import {
  cardFace,
  LOOKBOOK_PATH,
  lookbookGroups,
  lookbookRouteOf,
  lookbookSheetPath,
  modelReleaseRows,
  ownedLine,
  pairCards,
  RELEASES_SHOWN,
  SALON_NOTE_MAX,
  salonPicker,
  salonSizePick,
  selectDot,
  sheetLine,
  sheetModel,
  withRequest,
} from '../../src/web/verify/lookbook-model.js';
import type { LookbookCard, LookbookSheet, VerifyOutcome } from '../../src/web/verify/types.js';
import { resultViewModel } from '../../src/web/verify/view-model.js';
import { contextInput, modelContext } from '../../src/web/verify/messages-model.js';
import { brandForbiddenTerms, EXTRA_FORBIDDEN_EN, findForbidden } from '../docs/lexicon.js';

const media = (n: number) => `/api/v1/media/${n.toString(16).padStart(2, '0').repeat(32)}`;

function card(extra: Partial<LookbookCard> = {}): LookbookCard {
  return { slug: 'monolithe', name: 'Monolithe', type: 'Ring', category: { code: 'J', name: 'Jewelry' }, collection: 'Orbit', imageUrl: media(1), ...extra };
}

function sheet(extra: Partial<LookbookSheet> = {}): LookbookSheet {
  return {
    slug: 'monolithe',
    lookbook: 'PUBLIC',
    name: 'Monolithe',
    type: 'Ring',
    category: { code: 'J', name: 'Jewelry' },
    collection: 'Orbit',
    coverUrl: media(1),
    gallery: [
      { url: media(2), alt: 'The ring on its side' },
      { url: media(3), alt: null },
    ],
    story: 'The first ring of ORBES.\n\nCast in Paris.\nPolished by hand.',
    specs: [{ label: 'Metal', value: '925 sterling silver' }],
    care: null,
    discontinuedYear: null,
    ...extra,
  };
}

describe('the lookbook\'s grid (P-R02)', () => {
  it('groups the models by collection in the server\'s order, the models without one last and under no heading', () => {
    const groups = lookbookGroups([
      card({ slug: 'eclipse', name: 'Eclipse', collection: 'Nocturne' }),
      card({ slug: 'monolithe', collection: 'Orbit' }),
      card({ slug: 'orbe', name: 'Orbe', collection: 'Orbit', imageUrl: null }),
      card({ slug: 'aurore', name: 'Aurore 2026', collection: null }),
    ]);
    expect(groups.map((g) => [g.collection, g.cards.map((c) => c.slug)])).toEqual([
      ['NOCTURNE', ['eclipse']],
      ['ORBIT', ['monolithe', 'orbe']],
      [null, ['aurore']],
    ]);
    expect(groups[1]!.cards[0]).toEqual({
      slug: 'monolithe',
      href: '/verify/lookbook/monolithe',
      name: 'MONOLITHE',
      type: 'RING',
      image: { src: media(1), alt: PHOTOS.modelAlt('MONOLITHE', 'RING') },
      price: null,
      dots: [],
    });
    expect(groups[1]!.cards[1]!.image).toBeNull();
    expect(groups[2]!.cards[0]!.name).toBe('AURORE 2026');
  });

  it('shows a model and its variants as one card with its dots (NOCTURNE N6, C5), each switching its photograph, its price and SEE THE MODEL', () => {
    const dots = [
      { slug: 'monolithe', name: 'Monolithe', type: 'Bracelet', label: 'Steel', swatch: '#9D9B96', imageUrl: media(1), priceLabel: '€ 4 800' },
      { slug: 'monolithe-gold', name: 'Monolithe', type: 'Bracelet', label: 'Gold', swatch: '#B88A3A', imageUrl: media(2), priceLabel: '€ 5 200' },
      { slug: 'Not An Address', name: 'Monolithe', type: 'Bracelet', label: 'Rose', swatch: '#E6C578', imageUrl: media(3) },
      { slug: 'monolithe-blue', name: 'Monolithe', type: 'Bracelet', label: 'Blue', swatch: '#16224A', imageUrl: null },
    ];
    const groups = lookbookGroups([card({ type: 'Bracelet', variant: { label: 'Steel', swatch: '#9D9B96' }, variants: dots, priceLabel: '€ 4 800' }), card({ slug: 'orbe', name: 'Orbe', variants: [] })]);
    expect(groups[0]!.cards.map((c) => [c.slug, c.href, c.name, c.type])).toEqual([
      ['monolithe', '/verify/lookbook/monolithe', 'MONOLITHE', 'BRACELET'],
      ['orbe', '/verify/lookbook/orbe', 'ORBE', 'RING'],
    ]);
    const [monolithe, orbe] = groups[0]!.cards;
    expect(orbe!.dots).toEqual([]);
    // Its dots, the main model first, an address that is none left out; each photograph's text names the variant.
    expect(monolithe!.dots.map((d) => [d.slug, d.href, d.label, d.swatch, d.image, d.price])).toEqual([
      ['monolithe', '/verify/lookbook/monolithe', 'Steel', '#9D9B96', { src: media(1), alt: 'The MONOLITHE BRACELET model in steel, photographed by ORBES' }, '€ 4 800'],
      ['monolithe-gold', '/verify/lookbook/monolithe-gold', 'Gold', '#B88A3A', { src: media(2), alt: 'The MONOLITHE BRACELET model in gold, photographed by ORBES' }, '€ 5 200'],
      ['monolithe-blue', '/verify/lookbook/monolithe-blue', 'Blue', '#16224A', null, null],
    ]);
    // A dot selected: the card's photograph, price and SEE THE MODEL are that model's; an unknown dot, the card's own.
    expect(cardFace(monolithe!, 'monolithe-gold')).toMatchObject({ slug: 'monolithe-gold', href: '/verify/lookbook/monolithe-gold', image: { src: media(2) }, price: '€ 5 200' });
    expect(cardFace(monolithe!, 'monolithe-blue')).toMatchObject({ image: null, price: null });
    expect(cardFace(monolithe!, 'elsewhere')).toBe(monolithe);
    // A variant's sheet names it too.
    expect(sheetModel(sheet({ slug: 'monolithe-gold', variant: { label: 'Gold', swatch: '#B88A3A' } })).photos[0]!.alt).toBe('The MONOLITHE RING model in gold, photographed by ORBES');
  });

  it('says You own N of a card or a sheet across its variants, each variant owned named once, in the order of its dots', () => {
    const dots = [
      { slug: 'monolithe', label: 'Steel' },
      { slug: 'monolithe-gold', label: 'Gold' },
      { slug: 'monolithe-blue', label: 'Blue' },
    ];
    const pieces = (...slugs: (string | null)[]) => slugs.map((lookbook) => ({ lookbook }));
    expect(ownedLine('monolithe', dots, pieces('monolithe-gold', 'monolithe', null, 'orbe'))).toBe('You own two: steel and gold');
    expect(ownedLine('monolithe', dots, pieces('monolithe-blue', 'monolithe-blue'))).toBe('You own two: blue');
    expect(ownedLine('monolithe', dots, pieces('orbe'))).toBeNull();
    expect(ownedLine('orbe', [], pieces('orbe'))).toBe('You own one');
    expect(ownedLine('orbe', [], [])).toBeNull();
  });

  it('takes nothing the server did not send as it should: an address that is none, a photograph from elsewhere', () => {
    const groups = lookbookGroups([card({ slug: 'Not An Address' }), card({ slug: 'x'.repeat(81) }), card({ slug: 'ok', imageUrl: 'https://evil.example/x.jpg' }), card({ slug: 'ok2', imageUrl: '/api/v1/media/zz' })]);
    expect(groups.flatMap((g) => g.cards.map((c) => [c.slug, c.image]))).toEqual([
      ['ok', null],
      ['ok2', null],
    ]);
  });
});

describe('a model\'s sheet (P-R02)', () => {
  it('shows the cover then the gallery, each with its alternative text, the story, the specifications and the care', () => {
    const s = sheetModel(sheet());
    expect(s).toEqual({
      slug: 'monolithe',
      reserved: false,
      name: 'MONOLITHE',
      variant: null,
      type: 'RING',
      collection: 'ORBIT',
      category: 'JEWELRY',
      photos: [
        { src: media(1), alt: PHOTOS.modelAlt('MONOLITHE', 'RING') },
        { src: media(2), alt: 'The ring on its side' },
        { src: media(3), alt: PHOTOS.modelAlt('MONOLITHE', 'RING') },
      ],
      story: 'The first ring of ORBES.\n\nCast in Paris.\nPolished by hand.',
      specs: [['METAL', '925 STERLING SILVER']],
      care: DEFAULT_CARE,
      discontinued: null,
      salon: null,
      sizes: null,
      dots: [],
      releases: [],
      pairs: [],
    });
    // The model's own care; a RESERVED sheet; no story, no photograph from elsewhere, none twice.
    const reserved = sheetModel(sheet({ lookbook: 'RESERVED', care: '  Polish with a soft cloth. ', story: ' \n ', coverUrl: null, gallery: [{ url: media(2), alt: '' }, { url: media(2), alt: null }, { url: 'https://evil.example/a.jpg', alt: 'x' }] }));
    expect(reserved).toMatchObject({ reserved: true, care: 'Polish with a soft cloth.', story: null, photos: [{ src: media(2), alt: PHOTOS.modelAlt('MONOLITHE', 'RING') }] });
  });

  it('says DISCONTINUED · <year> on the line of a sheet whose model was (P-R06), after THE PRIVATE SALON', () => {
    expect(sheetModel(sheet()).discontinued).toBeNull();
    expect(sheetLine(sheetModel(sheet()))).toBe('RING');
    expect(sheetLine(sheetModel(sheet({ lookbook: 'RESERVED' })))).toBe(`RING · ${LOOKBOOK.reserved}`);
    const discontinued = sheetModel(sheet({ discontinuedYear: 2027 }));
    expect(discontinued.discontinued).toBe('DISCONTINUED · 2027');
    expect(sheetLine(discontinued)).toBe('RING · DISCONTINUED · 2027');
    expect(sheetLine(sheetModel(sheet({ lookbook: 'RESERVED', discontinuedYear: 2027 })))).toBe('RING · THE PRIVATE SALON · DISCONTINUED · 2027');
    // Only a year: anything else says nothing.
    for (const bad of [0, 2027.5, '2027' as unknown as number]) expect(sheetModel(sheet({ discontinuedYear: bad })).discontinued, String(bad)).toBeNull();
  });

  it('switches with its dots (NOCTURNE N6, C6, C33): each dot\'s photographs, story, facts, care, salon price and request; its sizes once for all', () => {
    const variant = (slug: string, label: string, swatch: string, extra: Partial<NonNullable<LookbookSheet['variants']>[number]> = {}) => ({
      slug,
      label,
      swatch,
      selected: false,
      lookbook: 'PUBLIC' as const,
      name: 'Monolithe',
      type: 'Ring',
      collection: 'Orbit',
      coverUrl: null,
      gallery: [],
      specs: [],
      care: null,
      discontinuedYear: null,
      ...extra,
    });
    const s = sheetModel(
      sheet({
        variant: { label: 'Steel', swatch: '#9D9B96' },
        sizes: ['16', '17', '18'],
        variants: [
          variant('monolithe', 'Steel', '#9D9B96', { selected: true }),
          variant('monolithe-gold', 'Gold', '#B88A3A', { coverUrl: media(4), story: 'The gold of MONOLITHE.', specs: [{ label: 'Metal', value: '18k yellow gold' }], care: 'Polish the gold.', discontinuedYear: 2027 }),
          variant('monolithe-onyx', 'Onyx', '#111111', { lookbook: 'RESERVED', salon: { priceLabel: '€ 9 000', minTier: 2, request: null } }),
          variant('Not An Address', 'Rose', '#E6C578'),
          variant('monolithe-blank', 'Blank', 'blue'),
        ],
      }),
    );
    expect(s.sizes).toBe('SIZES 16 · 17 · 18');
    expect(s.dots.map((d) => [d.slug, d.label, d.swatch])).toEqual([
      ['monolithe', 'Steel', '#9D9B96'],
      ['monolithe-gold', 'Gold', '#B88A3A'],
      ['monolithe-onyx', 'Onyx', '#111111'],
    ]);
    // The dot of the address asked is the sheet's own face.
    expect(s.dots[0]!.face).toMatchObject({ slug: 'monolithe', photos: s.photos, story: s.story });
    // Each face carries its own label (a salon message's CONCERNING names it: MONOLITHE IN ONYX).
    expect(s.variant).toBe('Steel');
    expect(selectDot(s, 'monolithe-onyx').variant).toBe('Onyx');
    const gold = selectDot(s, 'monolithe-gold');
    expect(gold).toMatchObject({
      slug: 'monolithe-gold',
      variant: 'Gold',
      photos: [{ src: media(4), alt: 'The MONOLITHE RING model in gold, photographed by ORBES' }],
      story: 'The gold of MONOLITHE.',
      specs: [['METAL', '18K YELLOW GOLD']],
      care: 'Polish the gold.',
      discontinued: 'DISCONTINUED · 2027',
      salon: null,
      sizes: 'SIZES 16 · 17 · 18',
    });
    expect(gold.dots).toBe(s.dots);
    // A dot without a story of its own sent (a server before N6): the sheet's.
    expect(selectDot(s, 'monolithe-onyx')).toMatchObject({ reserved: true, story: s.story, salon: { price: '€ 9 000', tier: 'PLATINE', request: null } });
    expect(sheetLine(selectDot(s, 'monolithe-onyx'))).toBe(`RING · ${LOOKBOOK.reserved}`);
    expect(selectDot(s, 'elsewhere')).toBe(s);
    // REQUEST THIS PIECE on a dot: REQUESTED on it and on its dot, nowhere else.
    const requested = withRequest(selectDot(s, 'monolithe-onyx'), 'monolithe-onyx', 'r-1', 'm-1');
    expect(requested.salon!.request).toEqual({ id: 'r-1', modelId: 'm-1', size: null });
    expect(selectDot(selectDot(requested, 'monolithe'), 'monolithe-onyx').salon!.request).toEqual({ id: 'r-1', modelId: 'm-1', size: null });
    // AC-01: requested with a size, REQUESTED says it.
    expect(withRequest(selectDot(s, 'monolithe-onyx'), 'monolithe-onyx', 'r-1', 'm-1', '52').salon!.request).toEqual({ id: 'r-1', modelId: 'm-1', size: '52' });
    expect(requested.dots[0]!.face.salon).toBeNull();
    // One dot alone is no choice: none.
    expect(sheetModel(sheet({ variants: [variant('monolithe', 'Steel', '#9D9B96', { selected: true })] })).dots).toEqual([]);
  });

  it('routes /verify/lookbook and its sheets, any case, and an address that is none to the lookbook itself', () => {
    expect(LOOKBOOK_PATH).toBe('/verify/lookbook');
    expect(lookbookSheetPath('monolithe-ring')).toBe('/verify/lookbook/monolithe-ring');
    expect(lookbookRouteOf('/verify/lookbook')).toEqual({ sheet: null });
    expect(lookbookRouteOf('/VERIFY/LOOKBOOK/')).toEqual({ sheet: null });
    expect(lookbookRouteOf('/verify/lookbook/Monolithe-Ring')).toEqual({ sheet: 'monolithe-ring' });
    expect(lookbookRouteOf('/verify/lookbook/not an address')).toEqual({ sheet: null });
    expect(lookbookRouteOf('/verify/lookbook/a/b')).toEqual({ sheet: null });
    expect(lookbookRouteOf('/verify/pieces')).toBeNull();
    expect(lookbookRouteOf('/verify/lookbooks')).toBeNull();
  });
});

describe('THE RELEASES OF THIS MODEL (plan NEXT-NINE, CO-01)', () => {
  const id = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
  const release = (n: number, kind: 'LIVE' | 'DRAW', opensAt: string, variant: string | null) => ({ id: id(n), kind, opensAt, variant });

  it('dates each release on the phone\'s calendar, says its kind and variant, opens its page, and names it whole for a screen reader', () => {
    const rows = modelReleaseRows(
      [
        release(1, 'LIVE', '2026-10-05T03:00:00.000Z', 'Steel'),
        release(2, 'LIVE', '2026-09-28T17:00:00.000Z', 'Gold'),
        release(3, 'DRAW', '2026-09-14T10:00:00.000Z', 'Gold'),
        release(4, 'DRAW', '2026-09-10T10:00:00.000Z', null),
      ],
      'Europe/Paris',
    );
    expect(rows).toEqual([
      { id: id(1), href: `/verify/releases/${id(1)}`, date: '5 OCT 2026', line: 'LIVE RELEASE · IN STEEL', label: 'LIVE RELEASE, 5 OCT 2026, in steel: see the release' },
      { id: id(2), href: `/verify/releases/${id(2)}`, date: '28 SEP 2026', line: 'LIVE RELEASE · IN GOLD', label: 'LIVE RELEASE, 28 SEP 2026, in gold: see the release' },
      { id: id(3), href: `/verify/releases/${id(3)}`, date: '14 SEP 2026', line: 'DRAW · IN GOLD', label: 'DRAW, 14 SEP 2026, in gold: see the release' },
      // A model alone: its kind only.
      { id: id(4), href: `/verify/releases/${id(4)}`, date: '10 SEP 2026', line: 'DRAW', label: 'DRAW, 10 SEP 2026: see the release' },
    ]);
    // The phone's calendar: 05:00 in Paris is still 4 October in New York.
    expect(modelReleaseRows([release(1, 'LIVE', '2026-10-05T03:00:00.000Z', null)], 'America/New_York')[0]!.date).toBe('4 OCT 2026');
    expect(modelReleaseRows([release(1, 'LIVE', '2026-10-05T03:00:00.000Z', null)], 'Not/AZone')[0]!.date).toBe('5 OCT 2026');
  });

  it('leaves out a release without an id of its own, a kind the server does not send, or an opening it cannot read; nothing but a list', () => {
    const good = release(9, 'DRAW', '2026-09-14T10:00:00.000Z', 'Blue');
    const rows = modelReleaseRows(
      [
        null,
        { ...good, id: '../admin' },
        { ...good, id: 'not-an-id' },
        { ...good, kind: 'SALON' },
        { ...good, opensAt: 'yesterday' },
        { ...good, opensAt: 12 },
        { ...good, variant: '   ' },
        good,
      ],
      'UTC',
    );
    expect(rows.map((r) => r.line)).toEqual(['DRAW', 'DRAW · IN BLUE']);
    for (const bad of [undefined, null, {}, 'list', 3]) expect(modelReleaseRows(bad, 'UTC')).toEqual([]);
  });

  it('keeps every row on the sheet whichever dot is chosen, and shows six before SHOW ALL N RELEASES', () => {
    expect(RELEASES_SHOWN).toBe(6);
    const releases = Array.from({ length: 9 }, (_, i) => release(i + 1, i % 2 ? 'LIVE' : 'DRAW', `2026-09-${String(20 - i).padStart(2, '0')}T10:00:00.000Z`, 'Steel'));
    const variants = [
      { slug: 'monolithe', label: 'Steel', swatch: '#9d9b96', selected: true, lookbook: 'PUBLIC' as const, name: 'Monolithe', type: 'Ring', collection: 'Orbit', coverUrl: media(1), gallery: [], story: null, specs: [], care: null, discontinuedYear: null },
      { slug: 'monolithe-blue', label: 'Blue', swatch: '#16224a', selected: false, lookbook: 'PUBLIC' as const, name: 'Monolithe', type: 'Ring', collection: 'Orbit', coverUrl: media(2), gallery: [], story: null, specs: [], care: null, discontinuedYear: null },
    ];
    const s = sheetModel(sheet({ variant: { label: 'Steel', swatch: '#9d9b96' }, variants, releases }), 'UTC');
    expect(s.releases).toHaveLength(9);
    expect(s.releases.map((r) => r.date).slice(0, 2)).toEqual(['20 SEP 2026', '19 SEP 2026']);
    expect(selectDot(s, 'monolithe-blue').releases).toEqual(s.releases);
    expect(withRequest(s, 'monolithe', 'r', 'm').releases).toEqual(s.releases);
    expect(s.releases.slice(0, RELEASES_SHOWN)).toHaveLength(6);
    expect(LOOKBOOK.releases.more(s.releases.length)).toBe('SHOW ALL 9 RELEASES');
    // A sheet from an older server, or of a model never released: no row, no section.
    expect(sheetModel(sheet()).releases).toEqual([]);
  });

  it('says it in the house\'s words: the title, the kinds, the variant, the more link', () => {
    expect(LOOKBOOK.releases.title).toBe('THE RELEASES OF THIS MODEL');
    expect(LOOKBOOK.releases.kind).toEqual({ LIVE: 'LIVE RELEASE', DRAW: 'DRAW' });
    expect(LOOKBOOK.releases.variant('Blue')).toBe('IN BLUE');
    expect(LOOKBOOK.releases.line('DRAW', null)).toBe('DRAW');
    expect(LOOKBOOK.releases.label('DRAW', '14 SEP 2026', 'Gold')).toBe('DRAW, 14 SEP 2026, in gold: see the release');
  });
});

describe('PAIRS WELL WITH (plan NEXT-NINE, BP-34)', () => {
  const pair = (over: Record<string, unknown> = {}) => ({ slug: 'zenith', name: 'Zenith', type: 'Bracelet', variant: null, imageUrl: media(4), reserved: false, ...over });

  it('names each card: the model, IN BLUE for a picked variant, its type, THE PRIVATE SALON for a reserved one; its sheet; its photograph from the media route', () => {
    expect(pairCards([pair({ reserved: true }), pair({ slug: 'monolithe-blue', name: 'MONOLITHE', variant: 'Blue', imageUrl: null })])).toEqual([
      { slug: 'zenith', href: '/verify/lookbook/zenith', title: 'ZENITH', line: 'BRACELET · THE PRIVATE SALON', label: 'ZENITH, bracelet: see the model', image: { src: media(4), alt: PHOTOS.modelAlt('ZENITH', 'BRACELET') } },
      { slug: 'monolithe-blue', href: '/verify/lookbook/monolithe-blue', title: 'MONOLITHE IN BLUE', line: 'BRACELET', label: 'MONOLITHE IN BLUE, bracelet: see the model', image: null },
    ]);
  });

  it('drops a photograph from anywhere but the media route (the words stay), and a card without an address or a name', () => {
    const cards = pairCards([
      pair({ imageUrl: 'https://evil.example/a.jpg' }),
      pair({ slug: '../admin' }),
      pair({ slug: null }),
      pair({ name: '  ' }),
      null,
      pair({ slug: 'halo', name: 'Halo', variant: '  ', imageUrl: null }),
    ]);
    expect(cards.map((c) => [c.slug, c.title, c.image])).toEqual([
      ['zenith', 'ZENITH', null],
      ['halo', 'HALO', null],
    ]);
    for (const bad of [undefined, null, {}, 'list']) expect(pairCards(bad)).toEqual([]);
  });

  it('keeps the cards whichever dot is chosen, and says it in the house\'s words', () => {
    const variants = [
      { slug: 'monolithe', label: 'Steel', swatch: '#9d9b96', selected: true, lookbook: 'PUBLIC' as const, name: 'Monolithe', type: 'Ring', collection: 'Orbit', coverUrl: media(1), gallery: [], story: null, specs: [], care: null, discontinuedYear: null },
      { slug: 'monolithe-blue', label: 'Blue', swatch: '#16224a', selected: false, lookbook: 'PUBLIC' as const, name: 'Monolithe', type: 'Ring', collection: 'Orbit', coverUrl: media(2), gallery: [], story: null, specs: [], care: null, discontinuedYear: null },
    ];
    const s = sheetModel(sheet({ variant: { label: 'Steel', swatch: '#9d9b96' }, variants, pairs: [pair()] }));
    expect(s.pairs.map((p) => p.slug)).toEqual(['zenith']);
    expect(selectDot(s, 'monolithe-blue').pairs).toEqual(s.pairs);
    expect(withRequest(s, 'monolithe', 'r', 'm').pairs).toEqual(s.pairs);
    expect(LOOKBOOK.pairs.title).toBe('PAIRS WELL WITH');
    expect(LOOKBOOK.pairs.withVariant('MONOLITHE', 'Blue')).toBe('MONOLITHE IN BLUE');
    expect(LOOKBOOK.pairs.withVariant('MONOLITHE', null)).toBe('MONOLITHE');
    expect(LOOKBOOK.pairs.line('BRACELET', false)).toBe('BRACELET');
  });
});

describe('THE PRIVATE SALON on /verify (P-X08)', () => {
  it('names a reserved card\'s price, and nothing the server did not send as a price', () => {
    const [group] = lookbookGroups([card({ slug: 'eclipse', priceLabel: ' € 4 800 ', minTier: 2 }), card({ slug: 'orbe', priceLabel: null }), card({ slug: 'aurore', priceLabel: 'x'.repeat(61) })]);
    expect(group!.cards.map((c) => [c.slug, c.price])).toEqual([
      ['eclipse', '€ 4 800'],
      ['orbe', null],
      ['aurore', null],
    ]);
  });

  it('gives a reserved sheet read through the club its price, its tier and the account\'s open request; nothing on a public sheet', () => {
    const salon = (extra: Partial<NonNullable<LookbookSheet['salon']>> = {}) => sheetModel(sheet({ lookbook: 'RESERVED', salon: { priceLabel: '€ 4 800', minTier: 2, request: null, ...extra } })).salon;
    expect(salon()).toEqual({ price: '€ 4 800', tier: 'PLATINE', request: null, sizes: [], suggested: null });
    expect(salon({ priceLabel: null, minTier: 1 })).toEqual({ price: null, tier: 'TITANE', request: null, sizes: [], suggested: null });
    expect(salon({ minTier: 3, request: { id: 'r-1', status: 'OPEN', createdAt: '2026-10-04T10:00:00.000Z', modelId: 'm-1' } })).toEqual({
      price: '€ 4 800',
      tier: 'PALLADIUM',
      request: { id: 'r-1', modelId: 'm-1', size: null },
      sizes: [],
      suggested: null,
    });
    // A closed request offers REQUEST THIS PIECE again; a tier the club does not have, nothing to request from.
    expect(salon({ request: { id: 'r-1', status: 'CLOSED', createdAt: '2026-10-04T10:00:00.000Z', modelId: 'm-1' } })!.request).toBeNull();
    expect(salon({ minTier: 4 })).toBeNull();
    expect(sheetModel(sheet({ lookbook: 'RESERVED' })).salon).toBeNull();
    expect(sheetModel(sheet({ salon: { priceLabel: '€ 1', minTier: 1, request: null } })).salon).toBeNull();
    // The tiers it names are the club's.
    expect([1, 2, 3].map((t) => salon({ minTier: t })!.tier)).toEqual([...SERVER_TIER_NAMES]);
  });

  it('offers YOUR SIZE for a model of two sizes or more: YOUR SIZES\' suggestion preselected to confirm, else NOT SURE YET, which sends no size; never a size the model lacks (AC-01)', () => {
    const salon = (extra: Partial<NonNullable<LookbookSheet['salon']>> = {}) => sheetModel(sheet({ lookbook: 'RESERVED', salon: { priceLabel: null, minTier: 1, request: null, ...extra } })).salon;
    // The sizes as the server sends them; a suggestion it does not list is no suggestion.
    expect(salon({ sizes: ['50', '52', '54'], suggestedSize: '52' })).toMatchObject({ sizes: ['50', '52', '54'], suggested: '52' });
    expect(salon({ sizes: ['50', '52'], suggestedSize: '60' })!.suggested).toBeNull();
    expect(salon({ sizes: ['50', 7 as unknown as string, ''], suggestedSize: null })!.sizes).toEqual(['50']);
    // The picker from two sizes; none for one size, none once requested.
    expect(salonPicker(salon({ sizes: ['50', '52'] }))).toEqual({ sizes: ['50', '52'], suggested: null });
    expect(salonPicker(salon({ sizes: ['52'], suggestedSize: '52' }))).toBeNull();
    expect(salonPicker(salon({ sizes: ['50', '52'], request: { id: 'r', status: 'OPEN', createdAt: '2026-10-04T10:00:00.000Z', modelId: 'm', size: '52' } }))).toBeNull();
    // What REQUEST THIS PIECE sends: the suggestion while untapped (from YOUR SIZES), the size tapped, or null.
    const suggested = salon({ sizes: ['50', '52', '54'], suggestedSize: '52' });
    expect(salonSizePick(suggested, null)).toEqual({ size: '52', fromYours: true });
    expect(salonSizePick(suggested, { size: '54' })).toEqual({ size: '54', fromYours: false });
    expect(salonSizePick(suggested, { size: '52' })).toEqual({ size: '52', fromYours: false });
    expect(salonSizePick(suggested, { size: null })).toEqual({ size: null, fromYours: false });
    expect(salonSizePick(suggested, { size: '99' })).toEqual({ size: null, fromYours: false });
    expect(salonSizePick(salon({ sizes: ['50', '52'] }), null)).toEqual({ size: null, fromYours: false });
    expect(salonSizePick(salon({ sizes: ['52'], suggestedSize: '52' }), null)).toEqual({ size: null, fromYours: false });
    // REQUESTED with its size, as the server keeps it.
    expect(salon({ request: { id: 'r', status: 'OPEN', createdAt: '2026-10-04T10:00:00.000Z', modelId: 'm', size: '52' } })!.request).toEqual({ id: 'r', modelId: 'm', size: '52' });
    // The words: YOUR SIZE, NOT SURE YET, its hint, and SIZE 52 under REQUESTED.
    expect([LOOKBOOK.salon.size, LOOKBOOK.salon.notSure, LOOKBOOK.salon.sizeHint, LOOKBOOK.salon.requestedSize('52')]).toEqual([
      'YOUR SIZE',
      'NOT SURE YET',
      'ORBES Client Services confirms it with you.',
      'SIZE 52',
    ]);
  });

  it('gives a PUBLIC sheet read through the club the dot of its variant in the salon: its price, its tier and the account\'s open request (N6)', () => {
    const base = sheet();
    const variant = (slug: string, label: string, extra: Partial<NonNullable<LookbookSheet['variants']>[number]> = {}) => ({
      slug,
      label,
      swatch: '#16224A',
      selected: false,
      lookbook: 'PUBLIC' as const,
      name: base.name,
      type: base.type,
      collection: base.collection,
      coverUrl: null,
      gallery: [],
      specs: [],
      care: null,
      discontinuedYear: null,
      ...extra,
    });
    const s = sheetModel(
      sheet({
        variant: { label: 'Dawn', swatch: '#9D9B96' },
        variants: [
          variant('monolithe', 'Dawn', { selected: true }),
          variant('monolithe-night', 'Night', { lookbook: 'RESERVED', salon: { priceLabel: '€ 6 200', minTier: 1, request: { id: 'r-2', status: 'OPEN', createdAt: '2026-10-04T10:00:00.000Z', modelId: 'm-2' } } }),
        ],
      }),
    );
    // The public model itself: no salon on its face; its dot of the salon carries its own.
    expect(s.salon).toBeNull();
    expect(s.dots.map((d) => d.slug)).toEqual(['monolithe', 'monolithe-night']);
    expect(selectDot(s, 'monolithe-night')).toMatchObject({ slug: 'monolithe-night', reserved: true, salon: { price: '€ 6 200', tier: 'TITANE', request: { id: 'r-2', modelId: 'm-2' } } });
    expect(selectDot(selectDot(s, 'monolithe-night'), 'monolithe').salon).toBeNull();
  });

  it('writes to ORBES Client Services about a request: the model attached by its id, the request named in its label (CS-01)', () => {
    const c = modelContext('m-1', 'ECLIPSE');
    expect(c).toEqual({ kind: 'MODEL', id: 'm-1', label: 'ECLIPSE · PRIVATE SALON REQUEST' });
    // The server is sent the model's id alone (never its slug, never an email): it finds the request itself.
    expect(contextInput(c)).toEqual({ kind: 'MODEL', id: 'm-1' });
  });

  it('mirrors the server\'s bounds, and says the salon in the lexicon', () => {
    expect([SALON_NOTE_MAX, SHOP_REQUEST_LIMITS.note, SHOP_REQUEST_LIMITS.resolution, PRICE_LABEL_MAX]).toEqual([SHOP_NOTE_MAX, SHOP_NOTE_MAX, SHOP_RESOLUTION_MAX, SERVER_PRICE_LABEL_MAX]);
    expect(LOOKBOOK.reserved).toBe('THE PRIVATE SALON');
    expect(LOOKBOOK.salon.request).toBe('REQUEST THIS PIECE');
    expect(LOOKBOOK.salon.requested).toBe('ORBES Client Services will contact you.');
    const words = [LOOKBOOK.reserved, LOOKBOOK.reservedLead, LOOKBOOK.teaser, LOOKBOOK.locked('PLATINE', 5), LOOKBOOK.signIn, LOOKBOOK.variant, ...Object.values(LOOKBOOK.salon)].join('\n');
    // Addition 7: the teaser says the salon's sentence, then what opens it; locked below an owner's tier (NOCTURNE, screen
    // 5), the same sentence, then the tier that opens it and its pieces.
    expect(LOOKBOOK.teaser.startsWith(`${LOOKBOOK.reservedLead} `)).toBe(true);
    expect(LOOKBOOK.locked('PLATINE', 5)).toBe(`${LOOKBOOK.reservedLead} It opens at PLATINE, from 5 pieces registered to your ORBES account.`);
    expect(findForbidden(words, [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN])).toEqual([]);
    expect(words).not.toContain('!');
  });
});

describe('the private salon in the console (P-X08)', () => {
  it('sends only what changed of a model\'s price and tier, the price as the server keeps it, and says before what it would refuse', () => {
    const m = { priceLabel: null, privateMinTier: 1, lookbook: 'RESERVED' as const };
    expect(salonForm(m)).toEqual({ priceLabel: '', minTier: '1' });
    expect(salonChange(m, { priceLabel: '  €   4 800 ', minTier: '2' })).toEqual({ priceLabel: '€ 4 800', privateMinTier: 2 });
    expect(normalizePriceLabel('  €   4 800 ')).toBe('€ 4 800');
    expect(salonChange({ ...m, priceLabel: '€ 4 800' }, { priceLabel: '€ 4 800', minTier: '1' })).toEqual({});
    expect(salonChange({ ...m, priceLabel: '€ 4 800' }, { priceLabel: '  ', minTier: '1' })).toEqual({ priceLabel: '' });
    expect(salonProblem({ priceLabel: 'x'.repeat(61), minTier: '1' })).toBe(`The price must be at most ${SERVER_PRICE_LABEL_MAX} characters.`);
    expect(salonProblem({ priceLabel: '', minTier: '4' })).toBe('Choose the tier the model is shown from.');
    expect(salonProblem({ priceLabel: 'Price on request', minTier: '3' })).toBeNull();
    expect(SALON_TIER_OPTIONS.map((o) => o.value)).toEqual(['1', '2', '3']);
    expect([1, 2, 3].map(salonTierName)).toEqual([...SERVER_TIER_NAMES]);
    expect(salonImpact({ lookbook: 'RESERVED' })).toMatch(/in the private salon now\.$/);
    expect(salonImpact({ lookbook: 'PUBLIC' })).toMatch(/a Public model shows no price\.$/);
  });

  it('the Requests tab: its status filter, who closes a request, the note and the outcome it needs, a request\'s model line', () => {
    expect([shopRequestStatusOf({ status: 'OPEN' }), shopRequestStatusOf({ status: 'CLOSED' }), shopRequestStatusOf({ status: 'x' }), shopRequestStatusOf({})]).toEqual(['OPEN', 'CLOSED', undefined, undefined]);
    expect(['AUDITOR', 'OPERATOR', 'ADMIN'].map((role) => canCloseRequest(role as 'AUDITOR', { status: 'OPEN' }))).toEqual([false, true, true]);
    expect(canCloseRequest('ADMIN', { status: 'CLOSED' })).toBe(false);
    expect(closeRequestProblem('  ')).toBe('Say in the note what was done for the client.');
    expect(closeRequestProblem('x'.repeat(2001))).toBe('The note must be at most 2000 characters.');
    expect(closeRequestProblem('Called the client.')).toBeNull();
    // The outcome the dialog asks: ACCEPTED (an order is created) or DECLINED, one of the two.
    expect(closeRequestProblem('Called the client.', '')).toBe('Say whether the request is accepted or declined.');
    expect(closeRequestProblem('Called the client.', 'MAYBE')).toBe('Say whether the request is accepted or declined.');
    expect(['ACCEPTED', 'DECLINED'].map((o) => closeRequestProblem('Called the client.', o))).toEqual([null, null]);
    expect(SHOP_REQUEST_OUTCOME_OPTIONS.map((o) => o.value)).toEqual(['', ...SHOP_REQUEST_OUTCOMES]);
    const model = { id: 'm', name: 'ECLIPSE', type: 'PENDANT', slug: 'eclipse', priceLabel: '€ 4 800' };
    expect(requestModelLine({ model })).toBe('PENDANT · € 4 800');
    expect(requestModelLine({ model: { ...model, priceLabel: null } })).toBe('PENDANT');
  });
});

describe('the words of a sheet, as both apps draw them, and the server keeps them', () => {
  it('mirror the server\'s bounds and the form of an address', () => {
    expect([LOOKBOOK_SLUG_MAX, LOOKBOOK_STORY_MAX, LOOKBOOK_SPECS_MAX, LOOKBOOK_SPEC_LABEL_MAX]).toEqual([SLUG_MAX, STORY_MAX, SPECS_MAX, SPEC_LABEL_MAX]);
    expect(LOOKBOOK_SLUG_RE.source).toBe(SLUG_RE.source);
    expect([GALLERY_MAX, GALLERY_ALT_MAX]).toEqual([SERVER_GALLERY_MAX, SERVER_GALLERY_ALT_MAX]);
    for (const slug of ['monolithe', 'monolithe-ring', 'orbe-2026']) expect(isLookbookSlug(slug), slug).toBe(true);
    for (const slug of ['', 'Monolithe', 'mono--lithe', '-mono', 'mono-', 'é', 'x'.repeat(81)]) expect(isLookbookSlug(slug), slug).toBe(false);
  });

  it('splits a story into paragraphs at a blank line, keeps a single line break inside one, and reads no Markdown', () => {
    expect(storyParagraphs('The first ring.\n\nCast in Paris.\nPolished by hand.')).toEqual([['The first ring.'], ['Cast in Paris.', 'Polished by hand.']]);
    expect(storyParagraphs('  A  \r\n \t \r\n\r\n**B** # C  ')).toEqual([['A'], ['**B** # C']]);
    expect(storyParagraphs('')).toEqual([]);
    expect(storyParagraphs(null)).toEqual([]);
    // What the server keeps reads the same: the paragraphs of a normalised story are those of the typed one.
    const typed = '  The first ring of ORBES.  \r\n\r\n\r\n\r\nCast in Paris.\nPolished by hand.  ';
    expect(storyParagraphs(normalizeStory(typed))).toEqual(storyParagraphs(typed));
  });

  it('reads specifications as the server parses them, and says before sending what the server would refuse, in its words', () => {
    const typed = 'Metal :  925 sterling silver \n\n Weight: 12 g\r\nSizes: 48 to 60\nNote: a: b';
    const kept = normalizeSpecs(typed)!;
    expect(specRows(typed)).toEqual(parseSpecs(kept));
    expect(specRows(kept)).toEqual([
      { label: 'Metal', value: '925 sterling silver' },
      { label: 'Weight', value: '12 g' },
      { label: 'Sizes', value: '48 to 60' },
      { label: 'Note', value: 'a: b' },
    ]);
    expect(specsProblem(typed)).toBeNull();
    for (const bad of ['Metal 925', 'Metal: silver\nSize 52: yes', 'Metal:', ': silver', `${'L'.repeat(41)}: x`, 'x'.repeat(1001)]) {
      let server: string | null = null;
      try {
        normalizeSpecs(bad);
      } catch (e) {
        server = (e as DomainError).publicMessage;
      }
      expect(server, bad.slice(0, 20)).not.toBeNull();
      expect(specsProblem(bad), bad.slice(0, 20)).toBe(server);
    }
  });
});

describe('the console\'s Lookbook page (P-R02)', () => {
  const model = (extra: Partial<Model> = {}): Model => ({
    id: '73c68b47-012d-4569-a59a-fd2effa613c1',
    name: 'MONOLITHE II',
    type: 'RING',
    skuPrefix: 'MNL-RG',
    category: { index: 1, code: 'J', name: 'Jewelry' },
    collection: null,
    defaultMaterial: null,
    careInstructions: null,
    active: true,
    imageUrl: null,
    products: 3,
    lookbook: 'HIDDEN',
    slug: null,
    story: null,
    specs: null,
    publishedAt: null,
    discontinuedAt: null,
    priceLabel: null,
    privateMinTier: 1,
    gallery: [],
    basePriceMinor: null,
    baseCurrency: null,
    careGuide: null,
    shopify: { productId: null, variants: 1, linked: 0 },
    variantOf: null,
    variantLabel: null,
    variantSwatch: null,
    variants: [],
    sizeType: null,
    sizesOffered: 0,
    createdAt: '2026-10-01T08:00:00.000Z',
    ...extra,
  });

  it('proposes an address from the name, and sends only what changed', () => {
    expect(proposeSlug('MONOLITHE II')).toBe('monolithe-ii');
    expect(proposeSlug('Éclipse — Nuit 2026')).toBe('eclipse-nuit-2026');
    expect(proposeSlug('   ')).toBe('');
    expect(proposeSlug(`${'word '.repeat(30)}`).length).toBeLessThanOrEqual(80);
    for (const name of ['MONOLITHE II', 'Éclipse — Nuit 2026', 'A'.repeat(200)]) expect(isLookbookSlug(proposeSlug(name)), name).toBe(true);
    const m = model();
    expect(publicationForm(m)).toEqual({ lookbook: 'HIDDEN', slug: 'monolithe-ii' });
    expect(publicationChange(m, { lookbook: 'PUBLIC', slug: ' Monolithe-II ' })).toEqual({ lookbook: 'PUBLIC', slug: 'monolithe-ii' });
    expect(publicationChange(model({ slug: 'monolithe-ii' }), { lookbook: 'HIDDEN', slug: 'monolithe-ii' })).toEqual({});
    expect(publicationChange(model({ slug: 'monolithe-ii' }), { lookbook: 'HIDDEN', slug: '' })).toEqual({ slug: '' });
  });

  it('says before sending what the server would refuse: a shown model without an address, a malformed one, a published one changed', () => {
    const m = model();
    expect(publicationProblem(m, { lookbook: 'PUBLIC', slug: '' })).toBe('A model shown in the lookbook needs the address of its sheet.');
    expect(publicationProblem(m, { lookbook: 'HIDDEN', slug: 'mono lithe' })).toMatch(/^The address is 1–80 lower-case letters and digits/);
    expect(publicationProblem(m, { lookbook: 'RESERVED', slug: 'monolithe-ii' })).toBeNull();
    const published = model({ lookbook: 'PUBLIC', slug: 'monolithe-ii', publishedAt: '2026-10-03T10:00:00.000Z' });
    expect(publicationProblem(published, { lookbook: 'HIDDEN', slug: 'monolithe-ii' })).toBeNull();
    expect(publicationProblem(published, { lookbook: 'PUBLIC', slug: 'monolithe-iii' })).toMatch(/never changes/);
  });

  it('moves a photograph of the gallery earlier or later, and gives it its alternative text, every photograph sent once', () => {
    const gallery = [3, 1, 2].map((p) => ({ sha256: String(p).repeat(64), url: '', alt: p === 2 ? 'Side' : null, position: p }));
    expect(galleryOrder(gallery)).toEqual([
      { sha256: '1'.repeat(64), alt: '' },
      { sha256: '2'.repeat(64), alt: 'Side' },
      { sha256: '3'.repeat(64), alt: '' },
    ]);
    expect(galleryMoved(gallery, 1, -1).map((g) => g.sha256[0])).toEqual(['2', '1', '3']);
    expect(galleryMoved(gallery, 1, 1).map((g) => g.sha256[0])).toEqual(['1', '3', '2']);
    expect(galleryMoved(gallery, 0, -1).map((g) => g.sha256[0])).toEqual(['1', '2', '3']);
    expect(galleryMoved(gallery, 2, 1).map((g) => g.sha256[0])).toEqual(['1', '2', '3']);
    expect(galleryWithAlt(gallery, '3'.repeat(64), '  The clasp ')).toEqual([
      { sha256: '1'.repeat(64), alt: '' },
      { sha256: '2'.repeat(64), alt: 'Side' },
      { sha256: '3'.repeat(64), alt: 'The clasp' },
    ]);
    // The default the sheet says is the result's own for THE MODEL.
    expect(defaultAlt(model())).toBe(PHOTOS.modelAlt('MONOLITHE II', 'RING'));
  });
});

describe('SEE THE MODEL under an authentic result (P-R02)', () => {
  const outcome = (extra: Partial<VerifyOutcome> = {}): VerifyOutcome => ({
    state: 'AUTHENTIC',
    scanId: '5a864af8-0d6b-4c1e-9f2a-3b7c1d2e4f5a',
    verifiedAt: '2026-10-03T10:00:00.000Z',
    title: 'AUTHENTIC',
    message: 'm',
    product: { productId: 'O26-J-00184', category: { code: 'J', name: 'Jewelry' }, model: 'MONOLITHE', type: 'RING', material: 'SILVER', createdYear: 2026, lookbook: 'monolithe-ring' },
    ...extra,
  });

  it('carries the address the server names, only on an authentic result, only when it is one', () => {
    expect(resultViewModel(outcome()).lookbook).toBe('monolithe-ring');
    expect(resultViewModel(outcome({ product: { ...outcome().product!, lookbook: 'Not An Address' } })).lookbook).toBeUndefined();
    expect(resultViewModel(outcome({ product: { ...outcome().product!, lookbook: undefined } })).lookbook).toBeUndefined();
    expect(resultViewModel(outcome({ state: 'REVOKED', title: 'REVOKED' })).lookbook).toBeUndefined();
  });
});

describe('the lookbook\'s copy', () => {
  it('writes no word of BRAND §4.5 (nor "product"), no exclamation mark, and DRAW never "lottery"', () => {
    // Each function said with what it takes: a name, or (NOCTURNE N3) the sizes and the pieces owned of a model.
    const ARGS: Record<string, unknown[]> = { sizes: ['16', '17', '18'], youOwn: [2, 'steel', 'gold'], locked: ['PALLADIUM', 5] };
    const lines = Object.entries(LOOKBOOK).flatMap(([k, v]) => (typeof v === 'function' ? [String((v as (...a: unknown[]) => string)(...(ARGS[k] ?? ['MONOLITHE'])))] : [String(v)]));
    // CO-01: THE RELEASES OF THIS MODEL's words.
    const r = LOOKBOOK.releases;
    lines.push(r.title, ...Object.values(r.kind), r.variant('Blue'), r.line('DRAW', 'IN BLUE'), r.label('LIVE RELEASE', '5 OCT 2026', 'Steel'), r.more(9));
    // BP-34: PAIRS WELL WITH's words.
    const p = LOOKBOOK.pairs;
    lines.push(p.title, p.withVariant('MONOLITHE', 'Blue'), p.line('BRACELET', true), p.label('MONOLITHE IN BLUE', 'BRACELET'));
    expect(lines.length).toBeGreaterThan(10);
    expect(findForbidden(lines.join('\n'), [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN])).toEqual([]);
    expect(lines.join('\n')).not.toMatch(/!|lottery/i);
    expect(verifyCopy.LOOKBOOK.link).toBe('THE COLLECTION');
    expect(verifyCopy.LOOKBOOK.seeModel).toBe('SEE THE MODEL');
    // The server's 404 says what the sheet says.
    expect(lookbookNotFound().publicMessage).toBe(LOOKBOOK.notFound);
    expect(lookbookNotFound()).toMatchObject({ code: 'LOOKBOOK_NOT_FOUND', httpStatus: 404 });
  });
});
