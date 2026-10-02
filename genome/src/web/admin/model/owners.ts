/**
 * The search field of Owners (A-06): one box for an email or a REF.
 *
 * Anything with an `@` is an email, which the server matches exactly (any
 * case, as at sign-in). Anything else must be a REF: the 8 characters
 * (0–9, A–F) the verify app prints after REF under every result, with or
 * without the word REF, or a whole scan id. The server parses both again;
 * this only spares a round trip for a typing mistake. Pure.
 */

export type OwnerSearch = { kind: 'email'; email: string } | { kind: 'ref'; ref: string } | { kind: 'invalid'; message: string };

const REF_RE = /^(?:REF[\s:#-]*)?[0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i;

export const OWNER_SEARCH_HINT = 'An exact email, or the REF under a result (8 characters, 0–9 and A–F).';

/** What the search box holds, or null when it is empty (the whole list). */
export function ownerSearch(input: string | null | undefined): OwnerSearch | null {
  const q = (input ?? '').trim();
  if (q === '') return null;
  if (q.includes('@')) return { kind: 'email', email: q };
  if (REF_RE.test(q)) return { kind: 'ref', ref: q.replace(/^REF[\s:#-]*/i, '').toUpperCase() };
  return { kind: 'invalid', message: 'Enter an exact email, or a REF of 8 characters (0–9, A–F).' };
}
