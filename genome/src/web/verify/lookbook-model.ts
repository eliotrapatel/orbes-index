/**
 * THE COLLECTION (P-R02): the lookbook's lists and sheets (API §8.8, §10.9)
 * → what /verify/lookbook and /verify/lookbook/<slug> show. Pure (no DOM)
 * and unit-tested, like the result's view-model.
 *
 *  - The grid: the models grouped by collection, in the server's order
 *    (collections by name, the models without one last, under no heading);
 *    each card names its model, its type and, when ORBES has one, its
 *    photograph; its address is a path of this app. A model and its variants
 *    come as one entry (NOCTURNE N1): each of its dots is a card of its own
 *    here, as each model was, until the grid draws the dots.
 *  - A sheet: the cover then the gallery, each with its alternative text
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
import type { LookbookCard, LookbookSheet, OwnedPiece } from './types.js';
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

/** The models of a list's entry: its dots (NOCTURNE N1), each a model of its own, or the entry's model alone. */
function entryModels(c: LookbookCard): { slug: string; name: string; type: string; imageUrl: string | null; priceLabel?: string | null; variant: string | null }[] {
  const dots = Array.isArray(c.variants) ? c.variants.filter((v) => isLookbookSlug(v?.slug)) : [];
  if (dots.length > 1) return dots.map((v) => ({ slug: v.slug, name: v.name, type: v.type, imageUrl: v.imageUrl, priceLabel: v.priceLabel, variant: v.label }));
  return [{ slug: c.slug, name: c.name, type: c.type, imageUrl: c.imageUrl, priceLabel: c.priceLabel, variant: c.variant?.label ?? null }];
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
  const dots = entryDots(c);
  const slugs = dots.length > 0 ? dots.map((d) => d.slug) : [c.slug];
  const owned = pieces.filter((p) => typeof p?.lookbook === 'string' && slugs.includes(p.lookbook));
  if (owned.length === 0) return null;
  const named = dots.filter((d) => owned.some((p) => p.lookbook === d.slug)).map((d) => d.label.toLowerCase());
  return LOOKBOOK.youOwn(owned.length, ...named);
}

/** The cards, grouped by collection in the order the server sent them; a card without an address is left out. */
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
    for (const c of entryModels(entry)) {
      group.cards.push({
        slug: c.slug,
        href: lookbookSheetPath(c.slug),
        name: upper(c.name),
        type: upper(c.type),
        image: typeof c.imageUrl === 'string' && MEDIA_SRC.test(c.imageUrl) ? { src: c.imageUrl, alt: modelAlt(c.name, c.type, c.variant) } : null,
        price: priceOf(c.priceLabel),
      });
    }
  }
  return groups;
}

/** P-X08: what THE PRIVATE SALON adds to a reserved sheet read through the club. */
export interface SalonModel {
  /** The price shown, or null. */
  price: string | null;
  /** The tier it is offered from (TITANE, PLATINE, PALLADIUM). */
  tier: string;
  /** The account's open request (REQUESTED: ORBES Client Services will contact it); null: REQUEST THIS PIECE is offered. */
  request: { id: string } | null;
}

export interface SheetModel {
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

export function sheetModel(s: LookbookSheet): SheetModel {
  const alt = modelAlt(s.name, s.type, s.variant?.label);
  const photos: LookbookPhoto[] = [];
  if (typeof s.coverUrl === 'string' && MEDIA_SRC.test(s.coverUrl)) photos.push({ src: s.coverUrl, alt });
  for (const g of Array.isArray(s.gallery) ? s.gallery : []) {
    if (typeof g?.url !== 'string' || !MEDIA_SRC.test(g.url) || photos.some((p) => p.src === g.url)) continue;
    photos.push({ src: g.url, alt: typeof g.alt === 'string' && g.alt.trim() ? g.alt.trim() : alt });
  }
  return {
    slug: s.slug,
    reserved: s.lookbook === 'RESERVED',
    name: upper(s.name),
    type: upper(s.type),
    collection: s.collection && s.collection.trim() ? upper(s.collection) : null,
    category: upper(s.category?.name),
    photos,
    story: storyParagraphs(s.story).length > 0 ? s.story : null,
    specs: (Array.isArray(s.specs) ? s.specs : []).filter((r) => r?.label && r?.value).map((r): Row => [upper(r.label), upper(r.value)]),
    care: s.care && s.care.trim() ? s.care.trim() : DEFAULT_CARE,
    discontinued: discontinuedLine(s.discontinuedYear),
    salon: s.lookbook === 'RESERVED' ? salonModel(s.salon) : null,
  };
}

/** The salon of a reserved sheet; null when the server sent none (a tier it does not name: nothing to request from). */
function salonModel(v: LookbookSheet['salon']): SalonModel | null {
  if (!v || typeof v !== 'object') return null;
  const tier = TIER_NAMES[Number(v.minTier)];
  if (!tier) return null;
  const r = v.request;
  return { price: priceOf(v.priceLabel), tier, request: r && typeof r.id === 'string' && r.status === 'OPEN' ? { id: r.id } : null };
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
