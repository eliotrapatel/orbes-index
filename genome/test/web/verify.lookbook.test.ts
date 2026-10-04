/**
 * THE COLLECTION (P-R02): the lookbook's grid and sheets as /verify shows them (lookbook-model.ts), the words both
 * apps draw from a sheet (shared/lookbook.ts: the story's paragraphs, the specifications' rows, what the console says
 * before it sends them), held to the server's own rules (services/lookbook.ts), the copy held to the lexicon, and SEE
 * THE MODEL under an authentic result. Pure: no DOM. The pages are driven in Chromium by verify.e2e.test.ts and the
 * console's by admin.e2e.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { lookbookNotFound, normalizeSpecs, normalizeStory, parseSpecs, SLUG_MAX, SLUG_RE, SPEC_LABEL_MAX, SPECS_MAX, STORY_MAX } from '../../src/server/services/lookbook.js';
import { GALLERY_ALT_MAX as SERVER_GALLERY_ALT_MAX, GALLERY_MAX as SERVER_GALLERY_MAX } from '../../src/server/services/media.js';
import { DomainError } from '../../src/server/errors.js';
import { defaultAlt, GALLERY_ALT_MAX, GALLERY_MAX, galleryMoved, galleryOrder, galleryWithAlt, proposeSlug, publicationChange, publicationForm, publicationProblem } from '../../src/web/admin/model/lookbook.js';
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
import { LOOKBOOK_PATH, lookbookGroups, lookbookRouteOf, lookbookSheetPath, sheetLine, sheetModel } from '../../src/web/verify/lookbook-model.js';
import type { LookbookCard, LookbookSheet, VerifyOutcome } from '../../src/web/verify/types.js';
import { resultViewModel } from '../../src/web/verify/view-model.js';
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
    });
    // The model's own care; a RESERVED sheet; no story, no photograph from elsewhere, none twice.
    const reserved = sheetModel(sheet({ lookbook: 'RESERVED', care: '  Polish with a soft cloth. ', story: ' \n ', coverUrl: null, gallery: [{ url: media(2), alt: '' }, { url: media(2), alt: null }, { url: 'https://evil.example/a.jpg', alt: 'x' }] }));
    expect(reserved).toMatchObject({ reserved: true, care: 'Polish with a soft cloth.', story: null, photos: [{ src: media(2), alt: PHOTOS.modelAlt('MONOLITHE', 'RING') }] });
  });

  it('says DISCONTINUED · <year> on the line of a sheet whose model was (P-R06), after RESERVED FOR OWNERS', () => {
    expect(sheetModel(sheet()).discontinued).toBeNull();
    expect(sheetLine(sheetModel(sheet()))).toBe('RING');
    expect(sheetLine(sheetModel(sheet({ lookbook: 'RESERVED' })))).toBe(`RING · ${LOOKBOOK.reserved}`);
    const discontinued = sheetModel(sheet({ discontinuedYear: 2027 }));
    expect(discontinued.discontinued).toBe('DISCONTINUED · 2027');
    expect(sheetLine(discontinued)).toBe('RING · DISCONTINUED · 2027');
    expect(sheetLine(sheetModel(sheet({ lookbook: 'RESERVED', discontinuedYear: 2027 })))).toBe('RING · RESERVED FOR OWNERS · DISCONTINUED · 2027');
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
    gallery: [],
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
