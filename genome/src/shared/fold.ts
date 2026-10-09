/**
 * A word folded for comparison (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.8 item 5, step 5.1): lower case, then
 * the common Latin diacritics removed, one letter for one letter, so « Saint-Étienne », « SAINT-ETIENNE » and
 * « saint-étienne » read as one city. Shared by the server and the console; no import from the server or the apps,
 * beside countries.ts and profile-rules.ts.
 *
 * The database's `orbes_fold(text)` (migration 0044_client_notes) is the same rule in SQL, `translate(lower(x), …)` over
 * these two lists: CITY in Segments and the city groups of the Collectors page read it through
 * `account_profiles_city_fold_idx`, and test/shared/fold.test.ts holds the two to the same answers. Not the `unaccent`
 * extension, which PGlite and the production image may lack. Letters the lists do not name (æ, œ, ß, other scripts) are
 * only lower-cased.
 */

/** The accented letters folded, in lower case (`lower()` runs first), each above its plain letter in FOLD_TO. */
export const FOLD_FROM = 'àáâãäåāăąçćĉċčďđèéêëēĕėęěĝğġģĥħìíîïĩīĭįıĵķĺļľŀłñńņňòóôõöøōŏőŕŗřśŝşšșţťŧțùúûüũūŭůűųŵýÿŷźżž';
/** The plain letter of each of FOLD_FROM, at the same place. */
export const FOLD_TO = 'aaaaaaaaacccccddeeeeeeeeegggghhiiiiiiiiijklllllnnnnooooooooorrrsssssttttuuuuuuuuuuwyyyzzz';

const FOLD = new Map([...FOLD_FROM].map((c, i) => [c, [...FOLD_TO][i]!]));

/** `orbes_fold` in JavaScript: lower case, then each letter of FOLD_FROM made its plain letter. */
export function fold(value: string): string {
  let out = '';
  for (const c of value.toLowerCase()) out += FOLD.get(c) ?? c;
  return out;
}
