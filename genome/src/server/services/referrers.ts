/**
 * The referring site of a visit (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.5 item 3, step 4.2): the host of the
 * page that sent the visitor (`document.referrer`, sent once per tab by the collector app), never its path nor its
 * query, which are dropped here and never stored.
 *
 *   - Only `http:`, `https:` and `android-app:` addresses are read (an Android app opening the page names its package:
 *     `android-app://com.instagram.android`); anything else is no site.
 *   - The host in lower case, without `www.` and without its port.
 *   - The app's own host (verify.theorbes.com) is no site: an inner move. theorbes.com is kept: a visit from the brand's
 *     site is worth seeing (the console labels it « theorbes.com (ORBES's site) »).
 *   - Known families are folded into one site (REFERRER_FAMILIES): Instagram's link shim and app, X's short links,
 *     Facebook's mobile and link hosts, every Google domain, YouTube's, Pinterest's, LinkedIn's, WhatsApp's and Reddit's
 *     short or outbound hosts; a subdomain of a family's site reads as that site.
 *   - A host that is not a plain name (`acquisition_sources.site`: `^[a-z0-9][a-z0-9.:-]{0,252}$`) is no site.
 */

/** Exact hosts (after `www.` is removed) folded into a family's site. */
export const REFERRER_FAMILIES: Readonly<Record<string, string>> = Object.freeze({
  'l.instagram.com': 'instagram.com',
  'com.instagram.android': 'instagram.com',
  't.co': 'x.com',
  'twitter.com': 'x.com',
  'mobile.twitter.com': 'x.com',
  'lm.facebook.com': 'facebook.com',
  'm.facebook.com': 'facebook.com',
  'l.facebook.com': 'facebook.com',
  'youtu.be': 'youtube.com',
  'pin.it': 'pinterest.com',
  'lnkd.in': 'linkedin.com',
  'wa.me': 'whatsapp.com',
  'out.reddit.com': 'reddit.com',
});

/** Sites whose subdomains read as the site itself (m.youtube.com → youtube.com). */
const FAMILY_SITES = ['instagram.com', 'x.com', 'facebook.com', 'youtube.com', 'pinterest.com', 'linkedin.com', 'whatsapp.com', 'reddit.com'] as const;

/** Every Google domain: google.com, google.fr, google.co.uk… */
const GOOGLE_RE = /^(?:[a-z0-9-]+\.)*google\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/;

/** What `acquisition_sources.site` accepts (migration 0043). */
export const SITE_RE = /^[a-z0-9][a-z0-9.:-]{0,252}$/;

/** The longest referrer read (the app sends at most 500 characters). */
export const REFERRER_MAX = 500;

const SCHEMES = new Set(['http:', 'https:', 'android-app:']);

const stripWww = (host: string) => (host.startsWith('www.') ? host.slice(4) : host);

/** The family's site of a host (already in lower case, without `www.`). */
export function foldSite(host: string): string {
  const exact = REFERRER_FAMILIES[host];
  if (exact) return exact;
  if (GOOGLE_RE.test(host)) return 'google.com';
  for (const site of FAMILY_SITES) if (host.endsWith(`.${site}`)) return site;
  return host;
}

/**
 * The referring site of `raw` as it is kept (see the header), or null: no address, another scheme, junk, or the app's
 * own host (`ownHost`, in lower case, as AcquisitionService.publicHost reads it).
 */
export function referrerHost(raw: unknown, ownHost: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > REFERRER_MAX) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!SCHEMES.has(url.protocol)) return null;
  const host = stripWww(url.hostname.toLowerCase().replace(/\.$/, ''));
  if (host.length === 0) return null;
  const own = stripWww(ownHost.toLowerCase());
  if (own.length > 0 && host === own) return null;
  const site = foldSite(host);
  return SITE_RE.test(site) ? site : null;
}
