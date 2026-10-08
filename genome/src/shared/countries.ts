/**
 * The countries a piece ships to (plan NEXT LOT of 2026-10-07, §3.6.B: « Shipping everywhere: any country »): every
 * officially assigned ISO 3166-1 alpha-2 code, read by the server's check of a delivery address (services/addresses.ts,
 * services/orders.ts) and by the collector app's COUNTRY select. A country is stored as its code; its English name
 * comes from `Intl.DisplayNames(['en'], { type: 'region' })`, as the console names a scan's country
 * (web/admin/model/analytics.ts countryName). Shared by the server and the app: no import from either.
 */

/** Every officially assigned ISO 3166-1 alpha-2 code, in alphabetical order. */
export const COUNTRY_CODES: readonly string[] = Object.freeze(
  (
    'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC ' +
    'CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD ' +
    'GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH ' +
    'KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW ' +
    'MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC ' +
    'SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY ' +
    'UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
  ).split(' '),
);

const KNOWN = new Set(COUNTRY_CODES);

/** Whether `code` is one of COUNTRY_CODES (upper case, as stored). */
export function isCountryCode(code: unknown): code is string {
  return typeof code === 'string' && KNOWN.has(code);
}

let regionNames: Intl.DisplayNames | null | undefined;

/** A country's English name ('FR' → 'France'); the code itself when the runtime has no names. */
export function countryName(code: string): string {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * A phone with its country code, as a delivery address takes it (migration 0039's CHECK): `+`, a digit, then 5 to 24
 * digits, spaces, dots, hyphens or brackets: `+33 6 12 34 56 78`.
 */
export const PHONE_RE = /^\+[0-9][0-9 ().-]{5,24}$/;
