/**
 * The legal pages of ORBES GENOME CODE (J-06): the privacy policy, the terms
 * of use, the legal notice and the FAQ, in French and English, served by the
 * legal app (src/web/legal/) at /legal and /legal/* (server/http/static.ts).
 *
 * Shared by the verification app, which links them at the foot of its
 * landing, under every result and under CREATE ACCOUNT (verify/views/common.ts),
 * and by the legal app itself (its router and its navigation). theorbes.com
 * may link the same addresses: they are the targets of its legal links too.
 */

/** The four pages, in the order of the links: PRIVACY · TERMS · LEGAL · HELP. */
export const LEGAL_PAGES = ['privacy', 'terms', 'notice', 'faq'] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number];

/** The legal app's base path: the index of the four pages. */
export const LEGAL_PATH = '/legal';

/** The address of one page: /legal/privacy, /legal/terms, /legal/notice, /legal/faq. */
export function legalPath(page: LegalPage): string {
  return `${LEGAL_PATH}/${page}`;
}

/**
 * The attribution DB-IP's licence asks for (Creative Commons Attribution 4.0, NOTICE.md): the scans are located with
 * its "IP to City Lite" database (GEO_MODE=mmdb). Its words and its link, beside the legal links wherever they are.
 */
export const GEOIP_ATTRIBUTION = Object.freeze({
  text: 'IP Geolocation by DB-IP',
  href: 'https://db-ip.com',
});
