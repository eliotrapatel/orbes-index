/**
 * YOUR PROFILE's model (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.1 P.8, §3.2 W.10.3; step 1.9): the row's line and
 * the view's completion sentence, the date of birth's three selects, the phone's COUNTRY CODE that follows COUNTRY, the
 * phone shown again, YOUR TASTES' two groups, the draft the view keeps while the sheet is open, and what SAVE sends.
 * Pure: no DOM. The field rules are the server's own (src/shared/profile-rules.ts); the server is the judge.
 */
import { COUNTRY_CODES, countryName, isCountryCode } from '../../shared/countries.js';
import { CALLING_CODES, latestBirthDate, TASTES_MAX, toInstagram } from '../../shared/profile-rules.js';
import { ACCOUNT_PROFILE } from './copy.js';
import type { AccountProfileInput, AccountProfileView, ProfileCompletionKey, ProfileTaste } from './types.js';
import { formatDate, formatDateLong } from './view-model.js';

export { toInstagram as instagramFromInput } from '../../shared/profile-rules.js';

type Completion = AccountProfileView['completion'];

/** The missing items in a sentence's list: 'your phone, your date of birth and your Instagram'. */
export function missingList(keys: readonly ProfileCompletionKey[]): string {
  const words = keys.map((k) => ACCOUNT_PROFILE.item[k]);
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** The view's line: 'Your profile is 60% complete. Missing: your phone, your date of birth and your Instagram.', or complete. */
export function completionLine(c: Completion): string {
  if (c.missing.length === 0) return ACCOUNT_PROFILE.done;
  return `${ACCOUNT_PROFILE.percent(c.percent)} ${ACCOUNT_PROFILE.missing(c.missing.map((k) => ACCOUNT_PROFILE.item[k]))}`;
}

/** The account sheet's row: `60% COMPLETE`, or COMPLETE. */
export function completionRow(c: Completion): string {
  return c.missing.length === 0 ? ACCOUNT_PROFILE.complete : ACCOUNT_PROFILE.percentRow(c.percent);
}

// ── The date of birth ──────────────────────────────────────────────────────

export interface Option {
  value: string;
  label: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * DAY (1 to 31, for every month: the server says a day that does not exist), MONTH (JAN to DEC) and YEAR (13 years
 * before `today`, 'YYYY-MM-DD' in Paris, down to 1900), each with its word first (no value).
 */
export function dobOptions(today: string): { days: Option[]; months: Option[]; years: Option[] } {
  const latest = Number(latestBirthDate(today).slice(0, 4));
  const years: Option[] = [];
  for (let y = latest; y >= 1900; y--) years.push({ value: String(y), label: String(y) });
  return {
    days: [{ value: '', label: ACCOUNT_PROFILE.day }, ...Array.from({ length: 31 }, (_, i) => ({ value: pad(i + 1), label: String(i + 1) }))],
    months: [{ value: '', label: ACCOUNT_PROFILE.month }, ...Array.from({ length: 12 }, (_, i) => ({ value: pad(i + 1), label: formatDate(`2000-${pad(i + 1)}-01`).split(' ')[1]! }))],
    years: [{ value: '', label: ACCOUNT_PROFILE.year }, ...years],
  };
}

/** The three selects read together: none chosen, a part only (refused before sending), or the date 'YYYY-MM-DD'. */
export function birthDateOf(day: string, month: string, year: string): { kind: 'none' } | { kind: 'partial' } | { kind: 'date'; date: string } {
  const chosen = [day, month, year].filter((v) => v !== '').length;
  if (chosen === 0) return { kind: 'none' };
  if (chosen < 3) return { kind: 'partial' };
  return { kind: 'date', date: `${year}-${month}-${day}` };
}

/** A date of birth in words: '14 MARCH 1994'. */
export function birthDateWords(date: string): string {
  return formatDateLong(date).toUpperCase();
}

// ── The phone ──────────────────────────────────────────────────────────────

/** COUNTRY CODE's options: 'Choose', then `France +33` for every country with a code, by its English name. */
export function codeOptions(): Option[] {
  const named = COUNTRY_CODES.filter((c) => CALLING_CODES[c] !== undefined)
    .map((c) => ({ value: c, label: `${countryName(c)} +${CALLING_CODES[c]}` }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'));
  return [{ value: '', label: ACCOUNT_PROFILE.choose }, ...named];
}

/**
 * The COUNTRY CODE once COUNTRY is `country` (the owner's choice: the phone's code follows the country): the country's,
 * while the number is empty or the code was never changed by hand; else the code chosen stays.
 */
export function followCountry(state: { code: string; codeChanged: boolean; number: string }, country: string): string {
  if (!isCountryCode(country) || CALLING_CODES[country] === undefined) return state.code;
  return !state.number.trim() || !state.codeChanged ? country : state.code;
}

/** Digits in groups from the right: of two for France, of three otherwise ('612345678' → '6 12 34 56 78'). */
function grouped(digits: string, size: number): string {
  const out: string[] = [];
  for (let end = digits.length; end > 0; end -= size) out.unshift(digits.slice(Math.max(0, end - size), end));
  return out.join(' ');
}

/**
 * A phone saved (E.164) as PHONE NUMBER shows it again, after its COUNTRY CODE: the national part grouped, in twos for
 * France, in threes otherwise; a number typed with another `+code` than its country's, as it was saved.
 */
export function phoneNational(e164: string, country: string): string {
  const code = CALLING_CODES[country];
  if (!code || !e164.startsWith(`+${code}`)) return e164;
  return grouped(e164.slice(code.length + 1), country === 'FR' ? 2 : 3);
}

/** A phone saved, in words: '+33 6 12 34 56 78' (display only; the stored value stays E.164). */
export function phoneDisplay(e164: string, country: string): string {
  const national = phoneNational(e164, country);
  return national === e164 ? e164 : `+${CALLING_CODES[country]} ${national}`;
}

// ── YOUR TASTES ────────────────────────────────────────────────────────────

/** A choice of YOUR TASTES: pressed or not; `retired`, the collection no longer shows it (NO LONGER IN THE COLLECTION). */
export interface TasteChoice {
  key: string;
  label: string;
  swatch: string | null;
  retired: boolean;
  pressed: boolean;
}

/**
 * FAVOURITE PIECES and FAVOURITE FINISHES as the view draws them: what the collection offers now, in its order, then the
 * choices held that it no longer shows, at the end, pressed while kept (unpressed and saved, they are gone for good). A
 * group with nothing to choose and nothing held is empty, and not shown.
 */
export function tasteGroups(view: AccountProfileView, chosen: { pieces: readonly string[]; finishes: readonly string[] }): { pieces: TasteChoice[]; finishes: TasteChoice[] } {
  const group = (offered: readonly { key: string; label: string; swatch?: string }[], held: readonly ProfileTaste[], keys: readonly string[]): TasteChoice[] => {
    const on = new Set(keys);
    const current = offered.map((o) => ({ key: o.key, label: o.label, swatch: o.swatch ?? null, retired: false, pressed: on.has(o.key) }));
    const shown = new Set(current.map((c) => c.key));
    const retired = held.filter((t) => t.retired && !shown.has(t.key)).map((t) => ({ key: t.key, label: t.label, swatch: t.swatch ?? null, retired: true, pressed: on.has(t.key) }));
    return [...current, ...retired];
  };
  return {
    pieces: group(view.options.pieces, view.profile.tastes.pieces, chosen.pieces),
    finishes: group(view.options.finishes, view.profile.tastes.finishes, chosen.finishes),
  };
}

/** A choice pressed: taken off when held, else added unless 30 are held already (`refused`: 'Up to 30.'). */
export function tasteToggle(keys: readonly string[], key: string, max = TASTES_MAX): { keys: string[]; refused: boolean } {
  if (keys.includes(key)) return { keys: keys.filter((k) => k !== key), refused: false };
  if (keys.length >= max) return { keys: [...keys], refused: true };
  return { keys: [...keys, key], refused: false };
}

// ── The draft, and what SAVE sends ─────────────────────────────────────────

/** What the view's fields hold, kept while the sheet is open (a trip to YOUR ADDRESSES and back included). */
export interface ProfileDraft {
  firstName: string;
  lastName: string;
  country: string;
  city: string;
  /** COUNTRY CODE: a country's code; `codeChanged` once chosen by hand. */
  phoneCode: string;
  codeChanged: boolean;
  phoneNumber: string;
  day: string;
  month: string;
  year: string;
  instagram: string;
  heardId: string;
  heardOther: string;
  pieces: string[];
  finishes: string[];
}

/** The draft of a profile as read: every field as saved, the phone's code its own (else the country's). */
export function draftOf(view: AccountProfileView): ProfileDraft {
  const p = view.profile;
  const country = p.country ?? '';
  return {
    firstName: p.firstName ?? '',
    lastName: p.lastName ?? '',
    country,
    city: p.city ?? '',
    phoneCode: p.phone?.country ?? (CALLING_CODES[country] !== undefined ? country : ''),
    codeChanged: false,
    phoneNumber: p.phone ? phoneNational(p.phone.number, p.phone.country) : '',
    day: '',
    month: '',
    year: '',
    instagram: p.instagram ?? '',
    heardId: p.heard?.optionId ?? '',
    heardOther: p.heard?.other ?? '',
    pieces: p.tastes.pieces.map((t) => t.key),
    finishes: p.tastes.finishes.map((t) => t.key),
  };
}

/** Whether the answer chosen is Other (IN A FEW WORDS shows under it). */
export function heardIsOther(view: AccountProfileView, heardId: string): boolean {
  return view.options.heard.some((o) => o.id === heardId && o.other);
}

/**
 * The request of SAVE: the whole profile with the version read, an empty field null; the phone only with a number;
 * Other's words only with Other; `birthDate` only when a date is entered (none was saved, none entered before).
 */
export function profileFromForm(d: ProfileDraft, view: AccountProfileView): AccountProfileInput {
  const words = (v: string) => (v.trim() === '' ? null : v.trim());
  const dob = birthDateOf(d.day, d.month, d.year);
  const entering = dob.kind === 'date' && view.profile.birthDate === null && !view.profile.birthDateLocked;
  return {
    version: view.profile.version,
    firstName: words(d.firstName),
    lastName: words(d.lastName),
    country: d.country === '' ? null : d.country,
    city: words(d.city),
    phone: d.phoneNumber.trim() ? { country: d.phoneCode, number: d.phoneNumber.trim() } : null,
    ...(entering ? { birthDate: dob.date } : {}),
    instagram: words(d.instagram),
    heard: d.heardId ? { optionId: d.heardId, other: heardIsOther(view, d.heardId) ? words(d.heardOther) : null } : null,
    tastes: { pieces: [...d.pieces], finishes: [...d.finishes] },
  };
}

/** The field a refusal of SAVE names, when the page can tell it (its focus goes there), else null (SAVE). */
export function refusalField(code: string, message: string): 'firstName' | 'lastName' | 'country' | 'city' | 'phoneCode' | 'phoneNumber' | 'birthDate' | 'instagram' | 'heard' | 'tastes' | null {
  if (code === 'HEARD_UNAVAILABLE') return 'heard';
  if (code === 'TASTE_UNKNOWN' || code === 'TASTES_TOO_MANY') return 'tastes';
  if (/first name/i.test(message)) return 'firstName';
  if (/last name/i.test(message)) return 'lastName';
  if (/country code/i.test(message)) return 'phoneCode';
  if (/country/i.test(message)) return 'country';
  if (/city/i.test(message)) return 'city';
  if (/phone/i.test(message)) return 'phoneNumber';
  if (/date/i.test(message)) return 'birthDate';
  if (/instagram/i.test(message)) return 'instagram';
  if (/your words/i.test(message)) return 'heard';
  return null;
}
