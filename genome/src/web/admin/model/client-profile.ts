/**
 * The client sheet's Profile in the console (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.4.1, C.4.2, §3.0 (h), step
 * 5.5), as pure functions: the header's lead, the team account's line under Status, the Profile's rows as each role reads
 * them (an AUDITOR reads the date of birth as an age band, and the phone, the city, the address and the Instagram
 * withheld), and its three dialogs (Edit the profile, Change the date of birth, Edit the address): their fields, the
 * checks made before anything is sent (the shared rules of src/shared/profile-rules.ts), the body sent, and the field a
 * refusal of the server names.
 *
 * Every time is Paris time, in the console's way of writing dates (`8 OCT 2026 · 14:02 Paris`).
 */
import { COUNTRY_CODES, countryName, isCountryCode } from '../../../shared/countries.js';
import { CALLING_CODES, CITY_MAX, cleanName, cleanWords, HEARD_OTHER_MAX, NAME_MAX, PHONE_NUMBER_MAX, TASTES_MAX, toE164, toInstagram } from '../../../shared/profile-rules.js';
import type { ClientAgeBand, ClientProfile, ClientProfileEdit, ClientProfileInput, ClientTaste } from '../types.js';
import { parisDateTime } from './links.js';

// ── Words ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The header's lead (C.4.1): the one existing text of the sheet that changes. */
export const OWNER_LEAD = 'The client’s account and tier, profile, tags and private notes, intelligence, pieces, orders, releases, answers, interest, segments and notes, transfers in progress and latest verifications.';
/** An AUDITOR's lead: its ending kept, the withheld fields added (C.4.1). */
export const OWNER_LEAD_MASKED = `${OWNER_LEAD} Emails are masked for your role. Phone, date of birth, address, Instagram and cities are withheld.`;
/** The team account's line under Status (§3.0 (d), §3.6 C.3 (2)). */
export const TEAM_ACCOUNT_LINE = 'This account’s email is a console login’s: it is left out of the Collectors page and the export.';

export const PROFILE_COPY = Object.freeze({
  title: 'Profile',
  note: 'What the client gave in YOUR PROFILE, and what Client Services changed.',
  withheld: 'Withheld',
  none: '—',
  edit: 'Edit the profile',
  changeBirthDate: 'Change the date of birth',
  editAddress: 'Edit the address',
  addAddress: 'Add an address',
  // Edit the profile
  editTitle: 'Edit the profile',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Profile saved.',
  unchanged: 'Nothing has changed.',
  failed: 'The profile could not be saved.',
  firstName: 'First name',
  lastName: 'Last name',
  country: 'Country',
  chooseCountry: 'Choose a country',
  city: 'City',
  phoneCountry: 'Phone country code',
  phoneNumber: 'Phone number',
  phoneHint: 'Not verified. With or without its leading 0.',
  noPhoneCode: 'No code',
  instagram: 'Instagram',
  instagramHint: 'The username or the profile link.',
  heard: 'How they heard',
  notAnswered: 'Not answered',
  setAside: '(set aside)',
  heardOther: 'Other’s words',
  pieces: 'Favourite pieces',
  finishes: 'Favourite finishes',
  retired: '(no longer in the collection)',
  noChoice: 'The collection offers none now.',
  // Change the date of birth
  birthTitle: 'Change the date of birth',
  birthBody:
    'The client enters the date of birth once; after that, only Client Services changes it, even after it is removed. The birthday credit is given at most once in 12 months, whatever the date, and only for a birthday the date was saved before.',
  birthField: 'Date of birth',
  birthHint: 'Empty removes it.',
  why: 'Why',
  whyHint: 'Kept as a private note on this sheet. Never shown to the client.',
  change: 'Change',
  birthSaved: 'Date of birth changed.',
  birthRemoved: 'Date of birth removed.',
  // Edit the address
  addressTitle: 'Edit the default address',
  addressNew: 'Add an address',
  addressBody: 'Orders already placed keep the address they were given.',
  addressName: 'Name',
  addressLines: 'Address',
  addressHint: 'As it is written on the parcel, one line each.',
  addressCountry: 'Country',
  addressPhone: 'Phone',
  addressPhoneHint: 'With its country code: +33 6 12 34 56 78.',
  addressSaved: 'Address saved.',
});

/** The age bands as staff read them: `25–34`. */
export const AGE_BAND_LABELS: Readonly<Record<ClientAgeBand, string>> = Object.freeze({
  under18: 'Under 18',
  '18-24': '18–24',
  '25-34': '25–34',
  '35-44': '35–44',
  '45-54': '45–54',
  '55-64': '55–64',
  '65plus': '65 and over',
});

/** What the completion line names as missing, in the shared rules' order. */
export const MISSING_LABELS: Readonly<Record<ClientProfile['completion']['missing'][number], string>> = Object.freeze({
  NAME: 'name',
  COUNTRY: 'country',
  BIRTH_DATE: 'date of birth',
  CITY: 'city',
  ADDRESS: 'address',
  PHONE: 'phone',
  INSTAGRAM: 'Instagram',
  PIECES: 'favourite pieces',
  FINISHES: 'favourite finishes',
  HEARD: 'how they heard',
});

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** A calendar day `YYYY-MM-DD` as the console writes it: `14 MAR 1994`. */
export function dayText(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** An instant's Paris day as the console writes it: `9 OCT 2026`. */
export function parisDayText(v: string | Date | null | undefined): string {
  return parisDateTime(v).split(' · ')[0]!;
}

// ── The rows ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** A phone in E.164 as the sheet writes it: the code, then the national part grouped (twos for France). */
export function phoneText(phone: { country: string; number: string }): string {
  const code = CALLING_CODES[phone.country];
  if (!code || !phone.number.startsWith(`+${code}`)) return phone.number;
  const national = phone.number.slice(code.length + 1);
  const size = phone.country === 'FR' ? 2 : 3;
  const groups: string[] = [];
  // From the right, so the first group is the short one.
  for (let end = national.length; end > 0; end -= size) groups.unshift(national.slice(Math.max(0, end - size), end));
  return `+${code} ${groups.join(' ')}`;
}

/** The national digits of a saved phone, as Edit the profile's number field shows them again. */
export function phoneNational(phone: { country: string; number: string } | null): string {
  if (!phone) return '';
  const code = CALLING_CODES[phone.country];
  return code && phone.number.startsWith(`+${code}`) ? phone.number.slice(code.length + 1) : phone.number;
}

/** A taste list: `RING · CUFF`, a retired one with its words after it; `None chosen` when empty. */
export function tastesText(list: readonly ClientTaste[]): string {
  if (list.length === 0) return 'None chosen';
  return list.map((t) => (t.retired ? `${t.label} ${PROFILE_COPY.retired}` : t.label)).join(' · ');
}

/** The Instagram profile's address. */
export const instagramHref = (username: string): string => `https://www.instagram.com/${encodeURIComponent(username)}/`;

/** The date of birth's value as the role reads it: `14 MAR 1994 · 32 years`, an AUDITOR's `Withheld · 25–34`. */
export function birthDateValue(p: ClientProfile): string {
  if (p.withheld.includes('birthDate')) return p.ageBand ? `${PROFILE_COPY.withheld} · ${AGE_BAND_LABELS[p.ageBand]}` : PROFILE_COPY.none;
  if (!p.birthDate) return PROFILE_COPY.none;
  return p.age === null ? dayText(p.birthDate) : `${dayText(p.birthDate)} · ${p.age} ${p.age === 1 ? 'year' : 'years'}`;
}

/** Who set the date of birth and when, or why there is none (C.4.2's four notes). */
export function birthDateNote(p: ClientProfile): string {
  if (p.birthDateBy === 'COLLECTOR' && p.birthDateAt) return `Entered by the client on ${parisDayText(p.birthDateAt)}`;
  if (p.birthDateBy === 'STAFF' && p.birthDateAt) return `Changed by Client Services on ${parisDayText(p.birthDateAt)}`;
  if (p.birthDateCollectorAt) return 'Removed by Client Services. The client entered it once and cannot enter it again: set it here.';
  return 'Not entered yet: the client enters it once in YOUR PROFILE.';
}

/** How they heard: the answer, Other with the client's words, or `Not answered`. */
export function heardText(p: ClientProfile): string {
  if (!p.heard) return 'Not answered';
  return p.heard.other ? `${p.heard.label}: “${p.heard.other}”` : p.heard.label;
}

export function heardNote(p: ClientProfile): string | undefined {
  if (!p.heard) return undefined;
  return `Answered on ${parisDayText(p.heard.at)}`;
}

/** The default address on three lines: its name, its lines, its country and phone. */
export function addressLines(p: ClientProfile): string[] | null {
  if (!p.address) return null;
  const lines = p.address.lines
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .join(', ');
  return [p.address.name, lines, `${countryName(p.address.country)} · ${p.address.phone}`];
}

export function addressNote(p: ClientProfile): string {
  if (!p.address) return 'No address saved.';
  const more = p.otherAddresses > 0 ? ` · ${p.otherAddresses} more saved` : '';
  return `The default delivery address, from YOUR ADDRESSES${more}`;
}

export function completionText(p: ClientProfile): string {
  return `${p.completion.percent}% complete`;
}

export function completionNote(p: ClientProfile): string {
  if (p.completion.missing.length === 0) return 'Every field is given';
  return `Missing: ${p.completion.missing.map((k) => MISSING_LABELS[k]).join(', ')}`;
}

export function lastChangedText(p: ClientProfile): string {
  if (!p.updatedAt) return PROFILE_COPY.none;
  return `${parisDateTime(p.updatedAt)} · ${p.updatedBy === 'STAFF' ? 'by Client Services' : 'by the client'}`;
}

/** A Profile row: its label, its words (or lines), its note; `kind` tells the view what to draw beyond words. */
export interface ProfileRow {
  label: string;
  value: string | string[];
  note?: string;
  kind?: 'instagram' | 'finishes' | 'address';
}

/** The Profile's rows (C.4.2's table), as the role reads them. */
export function profileRows(p: ClientProfile): ProfileRow[] {
  const held = (k: ClientProfile['withheld'][number]) => p.withheld.includes(k);
  const rows: ProfileRow[] = [
    { label: 'First name', value: p.firstName ?? PROFILE_COPY.none },
    { label: 'Last name', value: p.lastName ?? PROFILE_COPY.none },
    { label: 'Date of birth', value: birthDateValue(p), note: birthDateNote(p) },
    held('phone')
      ? { label: 'Phone', value: PROFILE_COPY.withheld }
      : { label: 'Phone', value: p.phone ? phoneText(p.phone) : PROFILE_COPY.none, note: p.phone ? 'As typed, not verified' : undefined },
    held('city') ? { label: 'City', value: PROFILE_COPY.withheld } : { label: 'City', value: p.city ?? PROFILE_COPY.none, note: p.city ? 'As typed by the client' : undefined },
    held('address')
      ? { label: 'Address', value: PROFILE_COPY.withheld }
      : { label: 'Address', value: addressLines(p) ?? PROFILE_COPY.none, note: addressNote(p), kind: p.address ? 'address' : undefined },
    held('instagram')
      ? { label: 'Instagram', value: PROFILE_COPY.withheld }
      : { label: 'Instagram', value: p.instagram ? `@${p.instagram}` : PROFILE_COPY.none, kind: p.instagram ? 'instagram' : undefined },
    { label: 'How they heard', value: heardText(p), note: heardNote(p) },
    { label: 'Favourite pieces', value: tastesText(p.tastes.pieces), note: 'From the collection’s types' },
    { label: 'Favourite finishes', value: tastesText(p.tastes.finishes), note: 'From the collection’s finishes', kind: p.tastes.finishes.length ? 'finishes' : undefined },
    { label: 'Profile', value: completionText(p), note: completionNote(p) },
    { label: 'Last changed', value: lastChangedText(p) },
  ];
  return rows;
}

/** The section's tools a role is offered (C.4.2): none for an AUDITOR or a DELETED account. */
export function profileTools(p: ClientProfile, o: { canEdit: boolean; status: string }): { edit: boolean; birthDate: boolean; address: 'edit' | 'add' | null } {
  const on = o.canEdit && o.status !== 'DELETED';
  return { edit: on, birthDate: on, address: on ? (p.address ? 'edit' : 'add') : null };
}

// ── Edit the profile ─────────────────────────────────────────────────────────────────────────────────────────────

/** The dialog's values, as its controls hold them. */
export interface ProfileForm {
  firstName: string;
  lastName: string;
  country: string;
  city: string;
  phoneCountry: string;
  phoneNumber: string;
  instagram: string;
  heard: string;
  heardOther: string;
  pieces: string[];
  finishes: string[];
}

/** The dialog's starting values: the profile as it is. */
export function profileFormOf(p: ClientProfile): ProfileForm {
  return {
    firstName: p.firstName ?? '',
    lastName: p.lastName ?? '',
    country: p.country ?? '',
    city: p.city ?? '',
    phoneCountry: p.phone?.country ?? p.country ?? '',
    phoneNumber: phoneNational(p.phone),
    instagram: p.instagram ?? '',
    heard: p.heard?.optionId ?? '',
    heardOther: p.heard?.other ?? '',
    pieces: p.tastes.pieces.map((t) => t.key),
    finishes: p.tastes.finishes.map((t) => t.key),
  };
}

/** Every country by its English name, after `Choose a country` while none is set. */
export function countrySelectOptions(current: string | null): { value: string; label: string }[] {
  const all = COUNTRY_CODES.map((c) => ({ value: c, label: countryName(c) })).sort((a, b) => a.label.localeCompare(b.label, 'en'));
  return current ? all : [{ value: '', label: PROFILE_COPY.chooseCountry }, ...all];
}

/** The phone's country codes: `France +33`, by name; `No code` first. */
export function phoneCodeOptions(): { value: string; label: string }[] {
  return [
    { value: '', label: PROFILE_COPY.noPhoneCode },
    ...COUNTRY_CODES.filter((c) => CALLING_CODES[c])
      .map((c) => ({ value: c, label: `${countryName(c)} +${CALLING_CODES[c]}` }))
      .sort((a, b) => a.label.localeCompare(b.label, 'en')),
  ];
}

/** How they heard: `Not answered`, the offered answers in their order, and the client's set-aside one, marked. */
export function heardSelectOptions(edit: ClientProfileEdit): { value: string; label: string }[] {
  const out = [{ value: '', label: PROFILE_COPY.notAnswered }, ...edit.options.heard.map((x) => ({ value: x.id, label: x.label }))];
  const h = edit.profile.heard;
  if (h && !edit.options.heard.some((x) => x.id === h.optionId)) out.push({ value: h.optionId, label: `${h.label} ${PROFILE_COPY.setAside}` });
  return out;
}

/** Whether the answer chosen is Other (its words then asked). */
export function isOtherAnswer(edit: ClientProfileEdit, optionId: string): boolean {
  if (edit.options.heard.some((x) => x.id === optionId && x.other)) return true;
  // The client's own answer, set aside since: Other only if it had words.
  return edit.profile.heard?.optionId === optionId && edit.profile.heard.other !== null;
}

/** A taste group's tick boxes: what the collection offers now, then the client's choices no longer in it, ticked. */
export function tasteChoices(kind: 'pieces' | 'finishes', edit: ClientProfileEdit): { key: string; label: string; swatch?: string; retired: boolean }[] {
  const offered = kind === 'pieces' ? edit.options.pieces.map((o) => ({ key: o.key, label: o.label, retired: false })) : edit.options.finishes.map((o) => ({ key: o.key, label: o.label, swatch: o.swatch, retired: false }));
  const retired = edit.profile.tastes[kind].filter((t) => t.retired).map((t) => ({ key: t.key, label: `${t.label} ${PROFILE_COPY.retired}`, swatch: t.swatch, retired: true }));
  return [...offered, ...retired];
}

/** A check before sending, under the field it names. */
export interface FormProblem {
  field: keyof ProfileForm;
  message: string;
}

/** What the server would refuse, said before it is sent (the shared rules), the first field first. */
export function profileFormProblem(f: ProfileForm, p: ClientProfile, otherChosen: boolean): FormProblem | null {
  for (const [field, which, was] of [
    ['firstName', 'first', p.firstName],
    ['lastName', 'last', p.lastName],
  ] as const) {
    const r = cleanName(f[field]);
    if (!r.ok) return { field, message: r.problem === 'TOO_LONG' ? `The ${which} name is ${NAME_MAX} characters at most.` : `The ${which} name contains characters that cannot be kept.` };
    if (r.value === null && was !== null) return { field, message: `Enter the ${which} name: once given, it is changed, never cleared.` };
  }
  if (f.country === '' && p.country !== null) return { field: 'country', message: 'Choose a country: once given, it is changed, never cleared.' };
  if (f.country !== '' && !isCountryCode(f.country)) return { field: 'country', message: 'Choose a country.' };
  const city = cleanWords(f.city, CITY_MAX);
  if (!city.ok) return { field: 'city', message: city.problem === 'TOO_LONG' ? `A city is ${CITY_MAX} characters at most.` : 'The city contains characters that cannot be kept.' };
  if (f.phoneNumber.trim() !== '') {
    if (f.phoneNumber.length > PHONE_NUMBER_MAX) return { field: 'phoneNumber', message: 'This phone number is too short or too long.' };
    const r = toE164(f.phoneCountry, f.phoneNumber);
    if (!r.ok) {
      if (r.problem === 'NO_CODE') return { field: 'phoneCountry', message: 'Choose the phone’s country code.' };
      return { field: 'phoneNumber', message: r.problem === 'NOT_DIGITS' ? 'Enter the phone number with digits only.' : 'This phone number is too short or too long.' };
    }
  }
  if (!toInstagram(f.instagram).ok) return { field: 'instagram', message: 'Enter an Instagram username: letters, numbers, full stops and underscores, 30 at most.' };
  if (otherChosen) {
    const other = cleanWords(f.heardOther, HEARD_OTHER_MAX);
    if (!other.ok) return { field: 'heardOther', message: other.problem === 'TOO_LONG' ? `Other’s words are ${HEARD_OTHER_MAX} characters at most.` : 'Other’s words contain characters that cannot be kept.' };
  }
  if (f.pieces.length > TASTES_MAX || f.finishes.length > TASTES_MAX) return { field: f.pieces.length > TASTES_MAX ? 'pieces' : 'finishes', message: 'Choose up to 30 favourite pieces and 30 favourite finishes.' };
  return null;
}

/** The body of PUT …/profile: the whole profile without the date of birth, with the version read. */
export function profileInput(f: ProfileForm, version: number, otherChosen: boolean): ClientProfileInput {
  const words = (v: string) => (v.trim() === '' ? null : v.trim());
  return {
    version,
    firstName: words(f.firstName),
    lastName: words(f.lastName),
    country: f.country === '' ? null : f.country,
    city: words(f.city),
    phone: f.phoneNumber.trim() === '' ? null : { country: f.phoneCountry, number: f.phoneNumber.trim() },
    instagram: words(f.instagram),
    heard: f.heard === '' ? null : { optionId: f.heard, other: otherChosen ? words(f.heardOther) : null },
    tastes: { pieces: [...f.pieces].sort(), finishes: [...f.finishes].sort() },
  };
}

/** Whether the dialog changed nothing: the body it would send equals the profile's own. */
export function profileUnchanged(f: ProfileForm, edit: ClientProfileEdit): boolean {
  const p = edit.profile;
  const start = profileFormOf(p);
  const sameList = (a: string[], b: string[]) => [...a].sort().join('\n') === [...b].sort().join('\n');
  const otherNow = isOtherAnswer(edit, f.heard);
  const phoneOf = (x: ProfileForm) => {
    if (x.phoneNumber.trim() === '') return '';
    const r = toE164(x.phoneCountry, x.phoneNumber);
    return `${x.phoneCountry} ${r.ok ? r.e164 : x.phoneNumber}`;
  };
  const insta = (v: string) => {
    const r = toInstagram(v);
    return r.ok ? r.value : v;
  };
  const trim = (v: string) => v.trim();
  return (
    trim(f.firstName) === trim(start.firstName) &&
    trim(f.lastName) === trim(start.lastName) &&
    f.country === start.country &&
    trim(f.city) === trim(start.city) &&
    phoneOf(f) === phoneOf(start) &&
    insta(f.instagram) === insta(start.instagram) &&
    f.heard === start.heard &&
    (!otherNow || trim(f.heardOther) === trim(start.heardOther)) &&
    sameList(f.pieces, start.pieces) &&
    sameList(f.finishes, start.finishes)
  );
}

/** The field a refusal of the server names (its words or its code), or null: then it is said under the dialog. */
export function profileErrorField(code: string, message: string): keyof ProfileForm | null {
  if (code === 'TASTE_UNKNOWN' || code === 'TASTES_TOO_MANY') return /finish/i.test(message) && !/pieces/i.test(message) ? 'finishes' : 'pieces';
  if (code === 'HEARD_UNAVAILABLE') return 'heard';
  if (code !== 'VALIDATION_FAILED') return null;
  if (/first name/i.test(message)) return 'firstName';
  if (/last name/i.test(message)) return 'lastName';
  if (/country code/i.test(message)) return 'phoneCountry';
  if (/phone/i.test(message)) return 'phoneNumber';
  if (/country/i.test(message)) return 'country';
  if (/city/i.test(message)) return 'city';
  if (/instagram/i.test(message)) return 'instagram';
  if (/words/i.test(message)) return 'heardOther';
  return null;
}

// ── Change the date of birth ─────────────────────────────────────────────────────────────────────────────────────

/** The reason's length at most (services/profiles.ts BIRTH_DATE_WHY_MAX). */
export const BIRTH_DATE_WHY_MAX = 500;

/** The date field's value on opening: the date as it is (an OPERATOR reads it). */
export const birthDateValueOf = (p: ClientProfile): string => p.birthDate ?? '';

/** The checks before Change is sent: a reason, at most 500 characters; nothing changed is said so. */
export function birthDateProblem(v: { birthDate: string; why: string }, p: ClientProfile): string | null {
  if ((v.birthDate || null) === p.birthDate) return PROFILE_COPY.unchanged;
  if (v.why.trim() === '') return 'Give the reason.';
  if ([...v.why.trim()].length > BIRTH_DATE_WHY_MAX) return `Give the reason in ${BIRTH_DATE_WHY_MAX} characters at most.`;
  return null;
}

/** The body of PUT …/birth-date. */
export function birthDateInput(v: { birthDate: string; why: string }, version: number): { version: number; birthDate: string | null; why: string } {
  return { version, birthDate: v.birthDate === '' ? null : v.birthDate, why: v.why.trim() };
}

// ── Edit the address ─────────────────────────────────────────────────────────────────────────────────────────────

/** The address dialog's starting values: the default address, or empty with the account's country. */
export function addressFormOf(p: ClientProfile): { name: string; address: string; country: string; phone: string } {
  if (p.address) return { name: p.address.name, address: p.address.lines, country: p.address.country, phone: p.address.phone };
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
  return { name, address: '', country: p.country ?? '', phone: p.phone ? phoneText(p.phone) : '' };
}

/** The address dialog's checks before it is sent (H2's words, services/addresses.ts `checkAddress`). */
export function addressProblem(v: { name: string; address: string; country: string; phone: string }, p: ClientProfile): string | null {
  if (v.name.trim() === '' || v.address.trim() === '') return 'Enter the name and the address.';
  if (!isCountryCode(v.country)) return 'Choose a country.';
  if (v.phone.trim() === '') return 'Enter a phone number with its country code.';
  const a = p.address;
  if (a && a.name === v.name.trim() && a.lines === v.address.trim() && a.country === v.country && a.phone === v.phone.trim()) return PROFILE_COPY.unchanged;
  return null;
}
