/**
 * A console link's address, `verify.theorbes.com/go/<code>` (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.6 item 2
 * and A.7.1, step 4.3), shared by the server (services/links.ts) and the console's New link dialog, so both read and
 * suggest it the same way. No import from the server or the apps; beside countries.ts and profile-rules.ts.
 *
 *   LINK_CODE_RE   3 to 32 lower-case letters, figures or dashes, no dash at either end (migration 0043's CHECK).
 *   suggestCode    the name made lower case, its accents removed, every other character a dash (runs of dashes made one,
 *                  none at either end), cut to 32.
 *   freeCode       the suggestion itself, or with `-2`, `-3`… when it is taken, still 32 characters at most.
 */

/** What `links.code` accepts (migration 0043 `links_code_check`). */
export const LINK_CODE_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
/** The longest address. */
export const LINK_CODE_MAX = 32;

/** The address suggested for a link's name: « Léa — TikTok » → « lea-tiktok »; '' when the name gives nothing. */
export function suggestCode(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LINK_CODE_MAX)
    .replace(/-+$/, '');
}

/** The first of `base`, `base-2`, `base-3`… that `taken` does not hold, each at most 32 characters. */
export function freeCode(base: string, taken: (code: string) => boolean): string {
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const code = `${base.slice(0, LINK_CODE_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken(code)) return code;
  }
}
