/**
 * The profile's rules (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.1 P.6.1, P.6.3, P.8.4 and §3.2 W.5, step 1.2),
 * shared by the server (services/profiles.ts, services/tastes.ts) and the collector app (YOUR PROFILE, the sign-up), so
 * both check a field the same way. Each cleaner answers the value as stored, or a problem the caller words: the server
 * in its refusals, the app in copy.ts. No import from the server or the app; beside H2's countries.ts.
 *
 *   cleanName          a first or last name: trimmed, NFC, 1 to 50 characters, no control character nor `<` `>`
 *                      (migration 0040's CHECK); empty is null.
 *   toE164             a phone typed after the country picked for its code: `+33612345678`. Spaces, dots, dashes and
 *                      brackets dropped; one leading trunk 0 dropped (not for IT, SM and VA: KEEPS_TRUNK_ZERO); a
 *                      number typed with its own `+code` kept as typed. Never checked by text message.
 *   CALLING_CODES      every country of countries.ts (and XK) → its ITU-T E.164 calling code, without the `+`.
 *   toInstagram        the username, lower case, without `@`, from a username or a pasted profile link.
 *   birthDateProblem   a date of birth that exists, from 1900-01-01 and at least 13 years before today (in Paris).
 *   completion         how complete a profile is: ten items of equal weight (COMPLETION_KEYS), an item with nothing
 *                      to choose left out of the count; never blocking anything.
 *   tasteKey           a favourite piece's or finish's key: trimmed, inner spaces made single, in capitals.
 */
// ── Names ──────────────────────────────────────────────────────────────────

/** A first or last name's length, in characters (migration 0040). */
export const NAME_MAX = 50;
/** A city's length, in characters (migration 0040). */
export const CITY_MAX = 80;
/** Other's words, « IN A FEW WORDS », in characters (migration 0040). */
export const HEARD_OTHER_MAX = 100;

/** What PostgreSQL's `[[:cntrl:]]` refuses, and the line and paragraph separators, plus `<` and `>`. */
const NOT_IN_WORDS = /[\p{Cc}\u2028\u2029<>]/u;

/** A cleaned text field: the value as stored (null when empty), or why it is refused. */
export type Cleaned<P extends string> = { ok: true; value: string | null } | { ok: false; problem: P };

/** Words of 1 to `max` characters, trimmed and NFC, with no control character nor `<` `>`; empty is null. */
export function cleanWords(v: unknown, max: number): Cleaned<'TOO_LONG' | 'INVALID'> {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false, problem: 'INVALID' };
  const s = v.normalize('NFC').trim();
  if (s === '') return { ok: true, value: null };
  if (NOT_IN_WORDS.test(s)) return { ok: false, problem: 'INVALID' };
  if ([...s].length > max) return { ok: false, problem: 'TOO_LONG' };
  return { ok: true, value: s };
}

/** A first or last name: 1 to 50 characters, any script; null when empty. */
export function cleanName(v: unknown): Cleaned<'TOO_LONG' | 'INVALID'> {
  return cleanWords(v, NAME_MAX);
}

// ── Phone ──────────────────────────────────────────────────────────────────

/**
 * Every country of countries.ts, and Kosovo (XK, +383), to its ITU-T E.164 calling code, without the `+`. Countries
 * sharing a code (the +1 of the North American plan, the +44 of the Crown Dependencies, the +7 of Kazakhstan…) carry
 * it whole: the area code is part of the number typed.
 */
export const CALLING_CODES: Readonly<Record<string, string>> = Object.freeze({
  AD: '376', AE: '971', AF: '93', AG: '1', AI: '1', AL: '355', AM: '374', AO: '244', AQ: '672', AR: '54', AS: '1', AT: '43', AU: '61', AW: '297', AX: '358', AZ: '994',
  BA: '387', BB: '1', BD: '880', BE: '32', BF: '226', BG: '359', BH: '973', BI: '257', BJ: '229', BL: '590', BM: '1', BN: '673', BO: '591', BQ: '599', BR: '55', BS: '1',
  BT: '975', BV: '47', BW: '267', BY: '375', BZ: '501',
  CA: '1', CC: '61', CD: '243', CF: '236', CG: '242', CH: '41', CI: '225', CK: '682', CL: '56', CM: '237', CN: '86', CO: '57', CR: '506', CU: '53', CV: '238', CW: '599',
  CX: '61', CY: '357', CZ: '420',
  DE: '49', DJ: '253', DK: '45', DM: '1', DO: '1', DZ: '213',
  EC: '593', EE: '372', EG: '20', EH: '212', ER: '291', ES: '34', ET: '251',
  FI: '358', FJ: '679', FK: '500', FM: '691', FO: '298', FR: '33',
  GA: '241', GB: '44', GD: '1', GE: '995', GF: '594', GG: '44', GH: '233', GI: '350', GL: '299', GM: '220', GN: '224', GP: '590', GQ: '240', GR: '30', GS: '500', GT: '502',
  GU: '1', GW: '245', GY: '592',
  HK: '852', HM: '672', HN: '504', HR: '385', HT: '509', HU: '36',
  ID: '62', IE: '353', IL: '972', IM: '44', IN: '91', IO: '246', IQ: '964', IR: '98', IS: '354', IT: '39',
  JE: '44', JM: '1', JO: '962', JP: '81',
  KE: '254', KG: '996', KH: '855', KI: '686', KM: '269', KN: '1', KP: '850', KR: '82', KW: '965', KY: '1', KZ: '7',
  LA: '856', LB: '961', LC: '1', LI: '423', LK: '94', LR: '231', LS: '266', LT: '370', LU: '352', LV: '371', LY: '218',
  MA: '212', MC: '377', MD: '373', ME: '382', MF: '590', MG: '261', MH: '692', MK: '389', ML: '223', MM: '95', MN: '976', MO: '853', MP: '1', MQ: '596', MR: '222', MS: '1',
  MT: '356', MU: '230', MV: '960', MW: '265', MX: '52', MY: '60', MZ: '258',
  NA: '264', NC: '687', NE: '227', NF: '672', NG: '234', NI: '505', NL: '31', NO: '47', NP: '977', NR: '674', NU: '683', NZ: '64',
  OM: '968',
  PA: '507', PE: '51', PF: '689', PG: '675', PH: '63', PK: '92', PL: '48', PM: '508', PN: '64', PR: '1', PS: '970', PT: '351', PW: '680', PY: '595',
  QA: '974',
  RE: '262', RO: '40', RS: '381', RU: '7', RW: '250',
  SA: '966', SB: '677', SC: '248', SD: '249', SE: '46', SG: '65', SH: '290', SI: '386', SJ: '47', SK: '421', SL: '232', SM: '378', SN: '221', SO: '252', SR: '597', SS: '211',
  ST: '239', SV: '503', SX: '1', SY: '963', SZ: '268',
  TC: '1', TD: '235', TF: '262', TG: '228', TH: '66', TJ: '992', TK: '690', TL: '670', TM: '993', TN: '216', TO: '676', TR: '90', TT: '1', TV: '688', TW: '886', TZ: '255',
  UA: '380', UG: '256', UM: '1', US: '1', UY: '598', UZ: '998',
  VA: '39', VC: '1', VE: '58', VG: '1', VI: '1', VN: '84', VU: '678',
  WF: '681', WS: '685',
  XK: '383',
  YE: '967', YT: '262',
  ZA: '27', ZM: '260', ZW: '263',
});

/** The countries whose numbers keep their leading 0 after the calling code: Italy, San Marino and the Vatican. */
export const KEEPS_TRUNK_ZERO: ReadonlySet<string> = new Set(['IT', 'SM', 'VA']);

/** A phone as stored (migration 0040): E.164, `+` then 7 to 15 digits. */
export const E164_RE = /^\+[1-9][0-9]{6,14}$/;

/** A phone number's length as typed, before it is cleaned. */
export const PHONE_NUMBER_MAX = 20;

/** Why a phone is refused: no code for its country, a character that is not a digit, or too short or too long. */
export type PhoneProblem = 'NO_CODE' | 'NOT_DIGITS' | 'LENGTH';

/**
 * The phone `number` typed after `country`'s calling code, in E.164 (`toE164('FR', '06 12 34 56 78')` →
 * `+33612345678`). A number typed with its own `+code` is kept as typed, whatever the country picked (the person typed
 * it); the country stays the one picked, for its code.
 */
export function toE164(country: unknown, number: unknown): { ok: true; e164: string } | { ok: false; problem: PhoneProblem } {
  const code = typeof country === 'string' ? CALLING_CODES[country] : undefined;
  if (code === undefined) return { ok: false, problem: 'NO_CODE' };
  if (typeof number !== 'string') return { ok: false, problem: 'NOT_DIGITS' };
  const typed = number.normalize('NFKC').replace(/[\s.()\-\u2010-\u2015]/g, '');
  let e164: string;
  if (typed.startsWith('+')) {
    if (!/^[0-9]*$/.test(typed.slice(1))) return { ok: false, problem: 'NOT_DIGITS' };
    e164 = typed;
  } else {
    if (!/^[0-9]*$/.test(typed)) return { ok: false, problem: 'NOT_DIGITS' };
    const national = !KEEPS_TRUNK_ZERO.has(country as string) && typed.startsWith('0') ? typed.slice(1) : typed;
    if (national === '') return { ok: false, problem: 'LENGTH' };
    e164 = `+${code}${national}`;
  }
  return E164_RE.test(e164) ? { ok: true, e164 } : { ok: false, problem: 'LENGTH' };
}

// ── Instagram ──────────────────────────────────────────────────────────────

/** An Instagram username as stored (migration 0040): lower case, no @, 1 to 30 letters, digits, full stops and underscores. */
export const INSTAGRAM_RE = /^[a-z0-9._]{1,30}$/;

/** A pasted profile link: with or without https://, www. (or m.), a trailing / or ?…. */
const INSTAGRAM_LINK = /^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/([^/?#\s]+)\/?(?:[?#].*)?$/i;

/** The Instagram username from what was typed: an @, capitals, a pasted link cleaned; empty is null. */
export function toInstagram(v: unknown): Cleaned<'INVALID'> {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false, problem: 'INVALID' };
  let s = v.trim();
  if (s === '') return { ok: true, value: null };
  const link = INSTAGRAM_LINK.exec(s);
  if (link) s = link[1]!;
  s = s.replace(/^@/, '').toLowerCase();
  return INSTAGRAM_RE.test(s) ? { ok: true, value: s } : { ok: false, problem: 'INVALID' };
}

// ── Date of birth ──────────────────────────────────────────────────────────

/** The earliest date of birth taken (migration 0040's CHECK). */
export const BIRTH_DATE_MIN = '1900-01-01';
/** The youngest age a date of birth may give: 13 years (question 2). */
export const BIRTH_MIN_AGE = 13;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Whether 'YYYY-MM-DD' is a day of the calendar (no 30 February, no 31 April). */
export function isCalendarDay(day: string): boolean {
  const m = ISO_DAY.exec(day);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo);
}

/**
 * The latest date of birth taken on `today` ('YYYY-MM-DD', in Paris): the same day 13 years before, or the last day of
 * that month when it has none (29 February of a common year → 28 February).
 */
export function latestBirthDate(today: string): string {
  const m = ISO_DAY.exec(today);
  if (!m) throw new TypeError(`not a day: ${today}`);
  const y = Number(m[1]) - BIRTH_MIN_AGE;
  const mo = Number(m[2]);
  return `${pad(y, 4)}-${pad(mo)}-${pad(Math.min(Number(m[3]), daysIn(y, mo)))}`;
}

/**
 * Why a date of birth is refused on `today` ('YYYY-MM-DD', in Paris), or null: INVALID when it is not 'YYYY-MM-DD',
 * NOT_A_DATE when the day does not exist (29 February of a common year, 31 April), OUT_OF_RANGE before 1900-01-01 or
 * less than 13 years before today (13 years exactly is taken).
 */
export function birthDateProblem(date: unknown, today: string): 'INVALID' | 'NOT_A_DATE' | 'OUT_OF_RANGE' | null {
  if (typeof date !== 'string' || !ISO_DAY.test(date)) return 'INVALID';
  if (!isCalendarDay(date)) return 'NOT_A_DATE';
  if (date < BIRTH_DATE_MIN || date > latestBirthDate(today)) return 'OUT_OF_RANGE';
  return null;
}

/** The age in whole years on `today` of someone born on `birthDate` (both 'YYYY-MM-DD'); 29 February counts on 28 February in a common year. */
export function ageOn(birthDate: string, today: string): number {
  const b = ISO_DAY.exec(birthDate);
  const t = ISO_DAY.exec(today);
  if (!b || !t) throw new TypeError('not a day');
  const [by, bm, bd] = [Number(b[1]), Number(b[2]), Number(b[3])];
  const [ty, tm, td] = [Number(t[1]), Number(t[2]), Number(t[3])];
  const birthdayThisYear = Math.min(bd, daysIn(ty, bm));
  return ty - by - (tm < bm || (tm === bm && td < birthdayThisYear) ? 1 : 0);
}

/** The age bands staff read (plan §3.0 (h), §3.6 C.6): an AUDITOR sees the band, never the date. */
export const AGE_BANDS = ['under18', '18-24', '25-34', '35-44', '45-54', '55-64', '65plus'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

/** The band of an age in whole years. */
export function ageBand(age: number): AgeBand {
  if (age < 18) return 'under18';
  if (age < 25) return '18-24';
  if (age < 35) return '25-34';
  if (age < 45) return '35-44';
  if (age < 55) return '45-54';
  if (age < 65) return '55-64';
  return '65plus';
}

// ── Completion ─────────────────────────────────────────────────────────────

/** The ten items of a profile's completion, of equal weight, in the order they are named. */
export const COMPLETION_KEYS = ['NAME', 'COUNTRY', 'BIRTH_DATE', 'CITY', 'ADDRESS', 'PHONE', 'INSTAGRAM', 'PIECES', 'FINISHES', 'HEARD'] as const;
export type CompletionKey = (typeof COMPLETION_KEYS)[number];

/** What `completion` reads of a profile (null: no profile row yet). */
export interface CompletionProfile {
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  city: string | null;
  phone: unknown | null;
  instagram: string | null;
  heard: unknown | null;
  tastes: { pieces: readonly unknown[]; finishes: readonly unknown[] };
}

/**
 * How complete a profile is: `percent` = the items done × 100 / the items counted, rounded (100 only when every counted
 * item is done), and the items `missing`, in COMPLETION_KEYS order. PIECES and FINISHES are left out of the count when
 * the catalogue offers none and the account holds none: an item with nothing to choose is never missing.
 */
export function completion(
  profile: CompletionProfile | null,
  account: { country: string | null },
  hasDefaultAddress: boolean,
  options: { pieces: readonly unknown[]; finishes: readonly unknown[] },
): { percent: number; missing: CompletionKey[] } {
  const p = profile;
  const done: Record<CompletionKey, boolean> = {
    NAME: !!p?.firstName && !!p?.lastName,
    COUNTRY: !!account.country,
    BIRTH_DATE: !!p?.birthDate,
    CITY: !!p?.city,
    ADDRESS: hasDefaultAddress,
    PHONE: !!p?.phone,
    INSTAGRAM: !!p?.instagram,
    PIECES: (p?.tastes.pieces.length ?? 0) > 0,
    FINISHES: (p?.tastes.finishes.length ?? 0) > 0,
    HEARD: !!p?.heard,
  };
  const counted = COMPLETION_KEYS.filter((k) => (k === 'PIECES' ? options.pieces.length > 0 || done.PIECES : k === 'FINISHES' ? options.finishes.length > 0 || done.FINISHES : true));
  const missing = counted.filter((k) => !done[k]);
  return { percent: Math.round(((counted.length - missing.length) * 100) / counted.length), missing };
}

// ── Tastes ─────────────────────────────────────────────────────────────────

/** A taste's key and label length (migration 0040: a type is at most 60, a variant's label 40). */
export const TASTE_KEY_MAX = 60;
/** The favourite pieces, and the favourite finishes, an account keeps at most. */
export const TASTES_MAX = 30;

/**
 * A favourite piece's or finish's key: the words trimmed, inner spaces made single, in capitals ('Rose  gold' →
 * 'ROSE GOLD'); null when empty, over 60 characters or with a control character.
 */
export function tasteKey(words: unknown): string | null {
  if (typeof words !== 'string') return null;
  const key = words.normalize('NFC').trim().replace(/\s+/g, ' ').toUpperCase();
  if (key === '' || [...key].length > TASTE_KEY_MAX || /[\p{Cc}\u2028\u2029]/u.test(key)) return null;
  return key;
}
