/**
 * The privacy policy's Advertising measurement section (lot M4, K27 A4; plan §6), shown by /legal/privacy only while the
 * console's conversions are switched on (the banner's PRIVACY link leads to its `#ads`). Its words come with lot M4's
 * legal step; this file declares its version now.
 *
 * ADS_TEXT_VERSION: the section's own version, the Paris date of its final commit (`YYYY-MM-DD`), recorded with each
 * advertising choice (`ad_consents.text_version`) and answered by GET /api/v1/consent. The server cannot read the web's
 * files (Dockerfile): services/ads.ts holds the same date, and test/services/ads.test.ts holds the two equal.
 */
export const ADS_TEXT_VERSION = '2026-10-26';
