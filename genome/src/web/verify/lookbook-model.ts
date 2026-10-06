/**
 * THE COLLECTION (P-R02): the lookbook's lists and sheets (API §8.8, §10.9)
 * → what /verify/lookbook and /verify/lookbook/<slug> show. Pure (no DOM)
 * and unit-tested, like the result's view-model.
 *
 *  - The grid: the models grouped by collection, in the server's order
 *    (collections by name, the models without one last, under no heading);
 *    each card names its model, its type and, when ORBES has one, its
 *    photograph; its address is a path of this app. A model and its variants
 *    are one entry (NOCTURNE N1), one card with its dots (N6, C5): each dot
 *    switches the card's photograph, its price in THE PRIVATE SALON and the
 *    address of SEE THE MODEL.
 *  - A sheet (N6, C6, C33): its dots, each the face of a model of its group
 *    (its photographs, story, facts, care, salon price and request), the one
 *    whose address was asked selected; then the cover then the gallery, each
 *    with its alternative text
 *    (the operator's, else "The MONOLITHE RING model, photographed by
 *    ORBES"), the story (its paragraphs drawn by shared/lookbook.ts, as the
 *    console's preview draws them), the specifications as rows and the care
 *    (the model's, else the general care text of the CARE tab); its line
 *    says DISCONTINUED · <year> once an ADMIN discontinued it (P-R06).
 *  - THE PRIVATE SALON (P-X08): a reserved card names its price; a reserved
 *    sheet read through the club its price, the tier it is offered from, and
 *    the account's open request (then ORBES Client Services will contact it)
 *    or REQUEST THIS PIECE, with an optional note.
 *  - NOCTURNE (N3, reused by THE COLLECTION in N6): an entry's dots (its
 *    variants, each with its address, label, colour and photograph), its
 *    sizes (SIZES 16 · 17 · 18, from the SKUs of the model and its
 *    variants), and the account's own pieces of it, counted from MY PIECES
 *    across its variants (« You own two: steel and gold »).
 *
 * Nothing the server did not send: a photograph is taken from this origin's
 * media route only, and an address only if it is one.
 */
import { isLookbookSlug, storyParagraphs } from '../shared/lookbook.js';
import { DEFAULT_CARE, DISCONTINUED, LOOKBOOK, PHOTOS } from './copy.js';
import type { LookbookCard, LookbookSheet, LookbookSheetVariant, OwnedPiece } from './types.js';
import { discontinuedYearOf, upper, type Row } from './view-model.js';

/** The account's note on a request of the private salon (P-X08): as the server holds it (services/salon.ts SHOP_NOTE_MAX). */
export const SALON_NOTE_MAX = 500;

/** The tiers of the club by level (1 TITANE, 2 PLATINE, 3 PALLADIUM), as the salon names the one a model is offered from. */
const TIER_NAMES: Readonly<Record<number, string>> = Object.freeze({ 1: 'TITANE', 2: 'PLATINE', 3: 'PALLADIUM' });

/** A price as the server sent it: one line of at most 60 characters, else nothing. */
function priceOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 && t.length <= 60 && !/[\p{Cc}]/u.test(t) ? t : null;
}

/** The grid of the lookbook, and the sheet of one model under it. */
export const LOOKBOOK_PATH = '/verify/lookbook';

export function lookbookSheetPath(slug: string): string {
  return `${LOOKBOOK_PATH}/${slug}`;
}

/** A photograph of the lookbook: a path of this origin's media route, never another address. */
const MEDIA_SRC = /^\/api\/v1\/media\/[0-9a-f]{64}$/;

export interface LookbookPhoto {
  src: string;
  alt: string;
}

export interface CardModel {
  slug: string;
  href: string;
  name: string;
  type: string;
  image: LookbookPhoto | null;
  /** P-X08: the price THE PRIVATE SALON shows on its card; null elsewhere, or without one. */
  price: string | null;
  /**
   * NOCTURNE N6 (C5): the dots of its entry, the main model first, each with the address of its sheet, its photograph
   * and (THE PRIVATE SALON) its price; none for a model shown alone.
   */
  dots: CardDot[];
}

/** A dot of a card of THE COLLECTION (N6): a model of the entry, what the card switches to with it. */
export interface CardDot extends EntryDot {
  href: string;
  /** THE PRIVATE SALON's price of that model, or null. */
  price: string | null;
}

export interface CollectionGroup {
  /** The collection's name, upper-case; null for the models without one (no heading). */
  collection: string | null;
  cards: CardModel[];
}

/**
 * What every photograph of a model says when the operator wrote nothing: as the result's THE MODEL does, its variant
 * named when it has one (NOCTURNE N1: « The MONOLITHE BRACELET model in blue, photographed by ORBES »).
 */
function modelAlt(name: string, type: string, variant?: string | null): string {
  return PHOTOS.modelAlt(upper(name), upper(type), variant);
}

/** A dot of an entry (NOCTURNE N1): a model of the group, its label and colour, its photograph, when it was first shown. */
export interface EntryDot {
  slug: string;
  /** « Steel » */
  label: string;
  /** #RRGGBB */
  swatch: string;
  name: string;
  type: string;
  image: LookbookPhoto | null;
  /** When it was first shown (ms), or null. */
  publishedAt: number | null;
}

const SWATCH = /^#[0-9a-f]{6}$/i;
const timeOf = (iso: unknown): number | null => {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** The dots of an entry, the main model first, as the server sent them; none for a model shown alone (fewer than two). */
export function entryDots(c: LookbookCard): EntryDot[] {
  const dots = (Array.isArray(c?.variants) ? c.variants : []).filter((v) => isLookbookSlug(v?.slug) && typeof v.label === 'string' && v.label.trim() !== '' && SWATCH.test(v.swatch ?? ''));
  if (dots.length < 2) return [];
  return dots.map((v) => ({
    slug: v.slug,
    label: v.label.trim(),
    swatch: v.swatch,
    name: upper(v.name),
    type: upper(v.type),
    image: typeof v.imageUrl === 'string' && MEDIA_SRC.test(v.imageUrl) ? { src: v.imageUrl, alt: modelAlt(v.name, v.type, v.label) } : null,
    publishedAt: timeOf(v.publishedAt),
  }));
}

/** An entry's photograph, its own model's (the main model's when it has dots). */
export function entryPhoto(c: LookbookCard): LookbookPhoto | null {
  return typeof c?.imageUrl === 'string' && MEDIA_SRC.test(c.imageUrl) ? { src: c.imageUrl, alt: modelAlt(c.name, c.type, c.variant?.label) } : null;
}

/** When an entry was last added to the collection (ms), or null. */
export function entryPublishedAt(c: LookbookCard): number | null {
  return timeOf(c?.publishedAt);
}

/** A model's sizes, from the SKUs of the model and its variants (NOCTURNE, addition 8): `SIZES 16 · 17 · 18`; null without one. */
export function sizesLine(sizes: unknown): string | null {
  const list = Array.isArray(sizes) ? sizes.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim().toUpperCase()) : [];
  return list.length > 0 ? LOOKBOOK.sizes(...list) : null;
}

/**
 * « You own two: steel and gold »: the account's pieces of an entry, its variants included, counted from MY PIECES by
 * the address of each piece's model (its sheet), each variant owned named once, in the order of the dots; null when it
 * owns none.
 */
export function youOwn(c: LookbookCard, pieces: readonly Pick<OwnedPiece, 'lookbook'>[]): string | null {
  return ownedLine(c.slug, entryDots(c), pieces);
}

/**
 * « You own two: steel and gold » for a model (its address, `slug`) and its dots (THE COLLECTION's card, a sheet: N6):
 * the account's pieces of any of them, each dot owned named once in their order; null when it owns none.
 */
export function ownedLine(slug: string, dots: readonly Pick<EntryDot, 'slug' | 'label'>[], pieces: readonly Pick<OwnedPiece, 'lookbook'>[]): string | null {
  const slugs = dots.length > 0 ? dots.map((d) => d.slug) : [slug];
  const owned = pieces.filter((p) => typeof p?.lookbook === 'string' && slugs.includes(p.lookbook));
  if (owned.length === 0) return null;
  const named = dots.filter((d) => owned.some((p) => p.lookbook === d.slug)).map((d) => d.label.toLowerCase());
  return LOOKBOOK.youOwn(owned.length, ...named);
}

/**
 * The cards, grouped by collection in the order the server sent them, one card for a model and its variants (its dots,
 * N6); a card without an address is left out.
 */
export function lookbookGroups(cards: readonly LookbookCard[]): CollectionGroup[] {
  const groups: CollectionGroup[] = [];
  for (const entry of cards) {
    if (!isLookbookSlug(entry?.slug)) continue;
    const collection = entry.collection && entry.collection.trim() ? upper(entry.collection) : null;
    let group = groups.at(-1);
    if (!group || group.collection !== collection) {
      group = { collection, cards: [] };
      groups.push(group);
    }
    const prices = new Map((Array.isArray(entry.variants) ? entry.variants : []).map((v) => [v?.slug, priceOf(v?.priceLabel)] as const));
    group.cards.push({
      slug: entry.slug,
      href: lookbookSheetPath(entry.slug),
      name: upper(entry.name),
      type: upper(entry.type),
      image: entryPhoto(entry),
      price: priceOf(entry.priceLabel),
      dots: entryDots(entry).map((d) => ({ ...d, href: lookbookSheetPath(d.slug), price: prices.get(d.slug) ?? null })),
    });
  }
  return groups;
}

/** What a card shows with a dot selected (`slug`): that model's address, name, type, photograph and price; the card itself for its own. */
export function cardFace(c: CardModel, slug: string): Pick<CardModel, 'slug' | 'href' | 'name' | 'type' | 'image' | 'price'> {
  const d = c.dots.find((x) => x.slug === slug);
  return d ? { slug: d.slug, href: d.href, name: d.name || c.name, type: d.type || c.type, image: d.image, price: d.price } : c;
}

/** P-X08: what THE PRIVATE SALON adds to a reserved sheet read through the club. */
export interface SalonModel {
  /** The price shown, or null. */
  price: string | null;
  /** The tier it is offered from (TITANE, PLATINE, PALLADIUM). */
  tier: string;
  /** The account's open request (REQUESTED: ORBES Client Services will contact it), with its model (CS-01: WRITE TO ORBES CLIENT SERVICES attaches it); null: REQUEST THIS PIECE is offered. */
  request: { id: string; modelId: string } | null;
}

/** What a sheet shows of one model of its group (N6: what its dot switches). */
export interface SheetFace {
  slug: string;
  /** THE PRIVATE SALON: a reserved sheet the club opened. */
  reserved: boolean;
  name: string;
  type: string;
  /** The collection, upper-case, or null. */
  collection: string | null;
  category: string;
  /** The cover first, then the gallery in its order. */
  photos: LookbookPhoto[];
  /** The story as the server keeps it, null without one: shared/lookbook.ts storyBlock draws its paragraphs. */
  story: string | null;
  specs: Row[];
  care: string;
  /** DISCONTINUED · <year> when the model was discontinued (P-R06), else null: said on the sheet's line. */
  discontinued: string | null;
  /** P-X08: the salon's price, tier and request of a reserved sheet; null on any other. */
  salon: SalonModel | null;
}

/** A dot of a sheet (N6, C6): a model of its group, its label and colour, and its face. */
export interface SheetDot {
  slug: string;
  /** « Steel » */
  label: string;
  /** #RRGGBB */
  swatch: string;
  face: SheetFace;
}

/** A model's sheet: the face of the dot selected (the model whose address was asked, or another dot once chosen). */
export interface SheetModel extends SheetFace {
  /** SIZES 16 · 17 · 18, from the SKUs of the models of its group (addition 8); null without one. */
  sizes: string | null;
  /** Its dots, the main model first; none for a model alone. */
  dots: SheetDot[];
}

function photosOf(cover: unknown, gallery: unknown, alt: string): LookbookPhoto[] {
  const photos: LookbookPhoto[] = [];
  if (typeof cover === 'string' && MEDIA_SRC.test(cover)) photos.push({ src: cover, alt });
  for (const g of Array.isArray(gallery) ? (gallery as LookbookSheet['gallery']) : []) {
    if (typeof g?.url !== 'string' || !MEDIA_SRC.test(g.url) || photos.some((p) => p.src === g.url)) continue;
    photos.push({ src: g.url, alt: typeof g.alt === 'string' && g.alt.trim() ? g.alt.trim() : alt });
  }
  return photos;
}

function faceOf(
  m: Pick<LookbookSheetVariant, 'slug' | 'lookbook' | 'name' | 'type' | 'collection' | 'coverUrl' | 'gallery' | 'specs' | 'care' | 'discontinuedYear' | 'salon'> & { story?: string | null },
  category: string,
  label: string | null | undefined,
  fallbackStory: string | null,
): SheetFace {
  const story = m.story === undefined ? fallbackStory : m.story;
  return {
    slug: m.slug,
    reserved: m.lookbook === 'RESERVED',
    name: upper(m.name),
    type: upper(m.type),
    collection: m.collection && m.collection.trim() ? upper(m.collection) : null,
    category,
    photos: photosOf(m.coverUrl, m.gallery, modelAlt(m.name, m.type, label)),
    story: storyParagraphs(story).length > 0 ? story : null,
    specs: (Array.isArray(m.specs) ? m.specs : []).filter((r) => r?.label && r?.value).map((r): Row => [upper(r.label), upper(r.value)]),
    care: m.care && m.care.trim() ? m.care.trim() : DEFAULT_CARE,
    discontinued: discontinuedLine(m.discontinuedYear),
    salon: m.lookbook === 'RESERVED' ? salonModel(m.salon) : null,
  };
}

export function sheetModel(s: LookbookSheet): SheetModel {
  const category = upper(s.category?.name);
  const face = faceOf(s, category, s.variant?.label, s.story);
  const dots: SheetDot[] = (Array.isArray(s.variants) ? s.variants : [])
    .filter((v) => isLookbookSlug(v?.slug) && typeof v.label === 'string' && v.label.trim() !== '' && SWATCH.test(v.swatch ?? ''))
    .map((v) => ({ slug: v.slug, label: v.label.trim(), swatch: v.swatch, face: v.slug === s.slug ? face : faceOf(v, category, v.label, s.story) }));
  return { ...face, sizes: sizesLine(s.sizes), dots: dots.length > 1 ? dots : [] };
}

/** The sheet with another of its dots selected (N6): that model's face; the sheet as it is for a slug it has no dot of. */
export function selectDot(m: SheetModel, slug: string): SheetModel {
  const d = m.dots.find((x) => x.slug === slug);
  return d ? { ...d.face, sizes: m.sizes, dots: m.dots } : m;
}

/** The sheet once the account requested the model of the dot `slug` (REQUEST THIS PIECE): REQUESTED on it, and on its dot. */
export function withRequest(m: SheetModel, slug: string, id: string, modelId: string): SheetModel {
  const requested = (f: SheetFace): SheetFace => (f.slug === slug && f.salon ? { ...f, salon: { ...f.salon, request: { id, modelId } } } : f);
  return { ...requested(m), sizes: m.sizes, dots: m.dots.map((d) => ({ ...d, face: requested(d.face) })) };
}

/** The salon of a reserved sheet; null when the server sent none (a tier it does not name: nothing to request from). */
function salonModel(v: LookbookSheet['salon']): SalonModel | null {
  if (!v || typeof v !== 'object') return null;
  const tier = TIER_NAMES[Number(v.minTier)];
  if (!tier) return null;
  const r = v.request;
  return { price: priceOf(v.priceLabel), tier, request: r && typeof r.id === 'string' && typeof r.modelId === 'string' && r.status === 'OPEN' ? { id: r.id, modelId: r.modelId } : null };
}

function discontinuedLine(year: unknown): string | null {
  const y = discontinuedYearOf(year);
  return y === null ? null : DISCONTINUED.line(y);
}

/** The line under a sheet's title: its type, THE PRIVATE SALON for a sheet the club opened (P-X08), DISCONTINUED · <year> (P-R06). */
export function sheetLine(s: Pick<SheetModel, 'type' | 'reserved' | 'discontinued'>): string {
  return [s.type, s.reserved ? LOOKBOOK.reserved : null, s.discontinued].filter((x): x is string => !!x).join(' · ');
}

/** The route of a path under /verify/lookbook: the grid, or a sheet by its address (anything else is the grid). */
export function lookbookRouteOf(path: string): { sheet: string | null } | null {
  const p = path.replace(/\/+$/, '').toLowerCase();
  if (p === LOOKBOOK_PATH) return { sheet: null };
  if (!p.startsWith(`${LOOKBOOK_PATH}/`)) return null;
  const slug = p.slice(LOOKBOOK_PATH.length + 1);
  return { sheet: isLookbookSlug(slug) ? slug : null };
}
