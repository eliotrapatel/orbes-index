/**
 * THE COLLECTION (P-R02): the lookbook's lists and sheets (API §8.8, §10.9)
 * → what /verify/lookbook and /verify/lookbook/<slug> show. Pure (no DOM)
 * and unit-tested, like the result's view-model.
 *
 *  - The grid: the models grouped by collection, in the server's order
 *    (collections by name, the models without one last, under no heading);
 *    each card names its model, its type and, when ORBES has one, its
 *    photograph; its address is a path of this app.
 *  - A sheet: the cover then the gallery, each with its alternative text
 *    (the operator's, else "The MONOLITHE RING model, photographed by
 *    ORBES"), the story (its paragraphs drawn by shared/lookbook.ts, as the
 *    console's preview draws them), the specifications as rows and the care
 *    (the model's, else the general care text of the CARE tab); its line
 *    says DISCONTINUED · <year> once an ADMIN discontinued it (P-R06).
 *
 * Nothing the server did not send: a photograph is taken from this origin's
 * media route only, and an address only if it is one.
 */
import { isLookbookSlug, storyParagraphs } from '../shared/lookbook.js';
import { DEFAULT_CARE, DISCONTINUED, LOOKBOOK, PHOTOS } from './copy.js';
import type { LookbookCard, LookbookSheet } from './types.js';
import { discontinuedYearOf, upper, type Row } from './view-model.js';

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
}

export interface CollectionGroup {
  /** The collection's name, upper-case; null for the models without one (no heading). */
  collection: string | null;
  cards: CardModel[];
}

/** What every photograph of a model says when the operator wrote nothing: as the result's THE MODEL does. */
function modelAlt(name: string, type: string): string {
  return PHOTOS.modelAlt(upper(name), upper(type));
}

/** The cards, grouped by collection in the order the server sent them; a card without an address is left out. */
export function lookbookGroups(cards: readonly LookbookCard[]): CollectionGroup[] {
  const groups: CollectionGroup[] = [];
  for (const c of cards) {
    if (!isLookbookSlug(c?.slug)) continue;
    const collection = c.collection && c.collection.trim() ? upper(c.collection) : null;
    let group = groups.at(-1);
    if (!group || group.collection !== collection) {
      group = { collection, cards: [] };
      groups.push(group);
    }
    group.cards.push({
      slug: c.slug,
      href: lookbookSheetPath(c.slug),
      name: upper(c.name),
      type: upper(c.type),
      image: typeof c.imageUrl === 'string' && MEDIA_SRC.test(c.imageUrl) ? { src: c.imageUrl, alt: modelAlt(c.name, c.type) } : null,
    });
  }
  return groups;
}

export interface SheetModel {
  slug: string;
  /** RESERVED FOR OWNERS: a sheet the club opened. */
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
}

export function sheetModel(s: LookbookSheet): SheetModel {
  const alt = modelAlt(s.name, s.type);
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
  };
}

function discontinuedLine(year: unknown): string | null {
  const y = discontinuedYearOf(year);
  return y === null ? null : DISCONTINUED.line(y);
}

/** The line under a sheet's title: its type, RESERVED FOR OWNERS for a sheet the club opened, DISCONTINUED · <year> (P-R06). */
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
