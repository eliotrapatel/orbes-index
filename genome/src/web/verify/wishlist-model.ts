/**
 * YOUR WISHLIST (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.2 W.10; API §10.26) → what the heart on a model's sheet and
 * the page /verify/wishlist show. Pure (no DOM) and unit-tested, like the lookbook's model.
 *
 *  - The heart (W.10.1): the dot shown is wished when the account's list holds it as SHOWN (each dot its own model, its
 *    own address). Signed out: shown, not pressed (a tap says the wishlist is kept in the account). Signed in with a
 *    list that could not be read, or a session that could not be read: not shown, so it never shows a wrong state.
 *  - The row of the account sheet (W.10.2): NONE YET, 1 MODEL, 3 MODELS (WISHLIST.count); nothing when unreadable.
 *  - The page's cards, the latest wished first as the server sends them: a model the reader may open now as THE
 *    COLLECTION's card (its photograph, from this origin's media route only; its collection; its name; its type, then
 *    IN BLUE for a variant, THE PRIVATE SALON for a model of the salon, DISCONTINUED · 2026 once discontinued; SEE THE
 *    MODEL at its own address, that dot selected); one it may not, its name and variant and NOT IN THE COLLECTION NOW,
 *    no photograph and no link. Each card names itself for REMOVE's sentence (MONOLITHE IN BLUE).
 *
 * Nothing is counted for anyone else: the list is the account's own, and no count is shown anywhere but its own row.
 */
import { isLookbookSlug } from '../shared/lookbook.js';
import { LOOKBOOK, WISHLIST } from './copy.js';
import { lookbookSheetPath, modelPhoto, type LookbookPhoto } from './lookbook-model.js';
import type { Wishlist, WishlistItem } from './types.js';
import { discontinuedYearOf, upper } from './view-model.js';

/** The page of YOUR WISHLIST, opened from the account sheet's row. */
export const WISHLIST_PATH = '/verify/wishlist';

/** Whether a path names YOUR WISHLIST (a trailing slash, any case). */
export function isWishlistPath(path: string): boolean {
  return path.replace(/\/+$/, '').toLowerCase() === WISHLIST_PATH;
}

/** The addresses of the models the account wishes for and may open now: the dots whose heart is pressed. */
export function wishedSlugs(list: Pick<Wishlist, 'items'> | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const i of Array.isArray(list?.items) ? list.items : []) if (i && i.state === 'SHOWN' && isLookbookSlug(i.slug)) out.add(i.slug);
  return out;
}

/** The heart on the sheet of the dot `slug`: whether it is shown, and pressed. */
export function heartState(signedIn: boolean | null, wished: ReadonlySet<string> | null, slug: string): { shown: boolean; pressed: boolean } {
  if (signedIn === false) return { shown: true, pressed: false };
  if (signedIn === null || wished === null) return { shown: false, pressed: false };
  return { shown: true, pressed: wished.has(slug) };
}

/** The account sheet's row: how many models the wishlist holds (NONE YET, 1 MODEL, 3 MODELS). */
export function wishlistCount(list: Pick<Wishlist, 'items'> | null | undefined): string | null {
  return list && Array.isArray(list.items) ? WISHLIST.count(list.items.length) : null;
}

/** A card of YOUR WISHLIST. */
export type WishlistCard =
  | {
      kind: 'shown';
      slug: string;
      href: string;
      /** MONOLITHE */
      name: string;
      /** REMOVE's sentence and the card's accessible name: MONOLITHE IN BLUE. */
      title: string;
      /** ORBITAL, or null. */
      collection: string | null;
      /** BRACELET · IN BLUE · THE PRIVATE SALON · DISCONTINUED · 2026 */
      line: string;
      image: LookbookPhoto | null;
    }
  | {
      kind: 'hidden';
      slug: string;
      name: string;
      title: string;
      /** IN BLUE · NOT IN THE COLLECTION NOW */
      line: string;
    };

/** The cards of the page, in the server's order (the latest wished first); an item without an address or a name is left out. */
export function wishlistCards(items: readonly WishlistItem[] | null | undefined): WishlistCard[] {
  const out: WishlistCard[] = [];
  for (const i of Array.isArray(items) ? items : []) {
    if (!i || !isLookbookSlug(i.slug) || typeof i.name !== 'string' || i.name.trim() === '') continue;
    const label = i.variant && typeof i.variant.label === 'string' && i.variant.label.trim() !== '' ? i.variant.label.trim() : null;
    const name = upper(i.name);
    const title = LOOKBOOK.pairs.withVariant(name, label);
    const variant = label ? LOOKBOOK.releases.variant(label) : null;
    if (i.state !== 'SHOWN') {
      out.push({ kind: 'hidden', slug: i.slug, name, title, line: [variant, WISHLIST.notShown].filter((x): x is string => !!x).join(' · ') });
      continue;
    }
    const type = upper(typeof i.type === 'string' ? i.type : '');
    const year = discontinuedYearOf(i.discontinuedYear);
    out.push({
      kind: 'shown',
      slug: i.slug,
      href: lookbookSheetPath(i.slug),
      name,
      title,
      collection: typeof i.collection === 'string' && i.collection.trim() !== '' ? upper(i.collection) : null,
      line: [type || null, variant, i.reserved === true ? WISHLIST.salon : null, year === null ? null : WISHLIST.discontinued(year)].filter((x): x is string => !!x).join(' · '),
      image: modelPhoto(i.imageUrl, i.name, type, label),
    });
  }
  return out;
}
