/**
 * YOUR WISHLIST (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.2 W.10; API §10.26) → what the heart on a model's sheet
 * shows. Pure (no DOM) and unit-tested, like the lookbook's model.
 *
 *  - The heart (W.10.1): the dot shown is wished when the account's list holds it as SHOWN (each dot its own model, its
 *    own address). Signed out: shown, not pressed (a tap says the wishlist is kept in the account). Signed in with a
 *    list that could not be read, or a session that could not be read: not shown, so it never shows a wrong state.
 *
 * Nothing is counted for anyone else: the list is the account's own.
 */
import { isLookbookSlug } from '../shared/lookbook.js';
import type { Wishlist } from './types.js';

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
