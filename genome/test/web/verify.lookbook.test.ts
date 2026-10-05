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
import { LOOKBOOK_PATH, lookbookGroups, lookbookRouteOf, lookbookSheetPath, SALON_NOTE_MAX, sheetLine, sheetModel } from '../../src/web/verify/lookbook-model.js';
import type { LookbookCard, LookbookSheet, VerifyOutcome } from '../../src/web/verify/types.js';
import { resultViewModel, salonContactModel } from '../../src/web/verify/view-model.js';
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
    });
    expect(groups[1]!.cards[1]!.image).toBeNull();
    expect(groups[2]!.cards[0]!.name).toBe('AURORE 2026');
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
    expect(salon()).toEqual({ price: '€ 4 800', tier: 'PLATINE', request: null });
    expect(salon({ priceLabel: null, minTier: 1 })).toEqual({ price: null, tier: 'TITANE', request: null });
    expect(salon({ minTier: 3, request: { id: 'r-1', status: 'OPEN', createdAt: '2026-10-04T10:00:00.000Z' } })).toEqual({ price: '€ 4 800', tier: 'PALLADIUM', request: { id: 'r-1' } });
    // A closed request offers REQUEST THIS PIECE again; a tier the club does not have, nothing to request from.
    expect(salon({ request: { id: 'r-1', status: 'CLOSED', createdAt: '2026-10-04T10:00:00.000Z' } })!.request).toBeNull();
    expect(salon({ minTier: 4 })).toBeNull();
    expect(sheetModel(sheet({ lookbook: 'RESERVED' })).salon).toBeNull();
    expect(sheetModel(sheet({ salon: { priceLabel: '€ 1', minTier: 1, request: null } })).salon).toBeNull();
    // The tiers it names are the club's.
    expect([1, 2, 3].map((t) => salon({ minTier: t })!.tier)).toEqual([...SERVER_TIER_NAMES]);
  });

  it('writes to ORBES Client Services about a request: the model in the subject, the model and the request in the body', () => {
    const c = salonContactModel({ email: 'clientservices@theorbes.com', phone: '+33 1 23 45 67 89', hours: 'Monday to Friday' }, 'ECLIPSE', 'r-1');
    expect(c).toMatchObject({ placement: 'salon', phone: { label: '+33 1 23 45 67 89', href: 'tel:+33123456789' }, hours: 'Monday to Friday' });
    const url = new URL(c!.mailto!);
    expect(url.searchParams.get('subject')).toBe('ORBES — ECLIPSE — REQUEST');
    expect(url.searchParams.get('body')).toBe('\r\n\r\nMODEL: ECLIPSE\r\nREQUEST: r-1');
    expect(salonContactModel({}, 'ECLIPSE', 'r-1')).toBeNull();
    expect(salonContactModel(undefined, 'ECLIPSE', 'r-1')).toBeNull();
  });

  it('mirrors the server\'s bounds, and says the salon in the lexicon', () => {
    expect([SALON_NOTE_MAX, SHOP_REQUEST_LIMITS.note, SHOP_REQUEST_LIMITS.resolution, PRICE_LABEL_MAX]).toEqual([SHOP_NOTE_MAX, SHOP_NOTE_MAX, SHOP_RESOLUTION_MAX, SERVER_PRICE_LABEL_MAX]);
    expect(LOOKBOOK.reserved).toBe('THE PRIVATE SALON');
    expect(LOOKBOOK.salon.request).toBe('REQUEST THIS PIECE');
    expect(LOOKBOOK.salon.requested).toBe('ORBES Client Services will contact you.');
    const words = [LOOKBOOK.reserved, LOOKBOOK.reservedLead, ...Object.values(LOOKBOOK.salon)].join('\n');
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
    const lines = Object.values(LOOKBOOK).flatMap((v) => (typeof v === 'function' ? [String((v as (s: string) => string)('MONOLITHE'))] : [String(v)]));
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
