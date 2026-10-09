/**
 * YOUR PROFILE's model (src/web/verify/profile-model.ts; plan CUSTOMER INTELLIGENCE §3.1 P.8, §3.2 W.10.3, P.16): the
 * completion sentence and the row's line, the missing list's commas and 'and', the date of birth's options and how its
 * three selects read, the COUNTRY CODE following COUNTRY until changed by hand, the phone shown again, YOUR TASTES' groups
 * (the retired at the end, the 30 cap), and what SAVE sends. Pure: no DOM. The view itself is driven in Chromium by
 * test/web/nocturne.profile.e2e.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { COUNTRY_CODES } from '../../src/shared/countries.js';
import { CALLING_CODES, toInstagram } from '../../src/shared/profile-rules.js';
import { ACCOUNT_PROFILE } from '../../src/web/verify/copy.js';
import {
  birthDateOf,
  birthDateWords,
  codeOptions,
  completionLine,
  completionRow,
  dobOptions,
  draftOf,
  followCountry,
  heardIsOther,
  instagramFromInput,
  missingList,
  phoneDisplay,
  phoneNational,
  profileFromForm,
  refusalField,
  tasteGroups,
  tasteToggle,
} from '../../src/web/verify/profile-model.js';
import type { AccountProfileView } from '../../src/web/verify/types.js';

const OTHER = '8d2f0c55-6f0e-4bb7-9d41-6a1a7f3f0c01';
const FRIEND = '8d2f0c55-6f0e-4bb7-9d41-6a1a7f3f0c02';

function view(over: Partial<AccountProfileView['profile']> = {}, rest: Partial<Omit<AccountProfileView, 'profile'>> = {}): AccountProfileView {
  return {
    profile: {
      firstName: null,
      lastName: null,
      country: null,
      city: null,
      phone: null,
      birthDate: null,
      birthDateLocked: false,
      instagram: null,
      heard: null,
      tastes: { pieces: [], finishes: [] },
      version: 0,
      ...over,
    },
    options: {
      pieces: [
        { key: 'BRACELET', label: 'BRACELET' },
        { key: 'RING', label: 'RING' },
      ],
      finishes: [
        { key: 'BLUE', label: 'Blue', swatch: '#16224A' },
        { key: 'GOLD', label: 'Gold', swatch: '#B88A3A' },
      ],
      heard: [
        { id: FRIEND, label: 'A friend', other: false },
        { id: OTHER, label: 'Other', other: true },
      ],
    },
    address: null,
    addresses: 0,
    completion: { percent: 0, missing: ['NAME', 'COUNTRY', 'BIRTH_DATE', 'CITY', 'ADDRESS', 'PHONE', 'INSTAGRAM', 'PIECES', 'FINISHES', 'HEARD'] },
    ...rest,
  };
}

describe('YOUR PROFILE: how complete it is (plan CUSTOMER INTELLIGENCE §3.1 P.6.1, P.8.3)', () => {
  it('says the percentage and what is missing, a list with commas and a last « and »', () => {
    expect(completionLine({ percent: 60, missing: ['BIRTH_DATE', 'PHONE', 'INSTAGRAM'] })).toBe('Your profile is 60% complete. Missing: your date of birth, your phone and your Instagram.');
    expect(completionLine({ percent: 90, missing: ['HEARD'] })).toBe('Your profile is 90% complete. Missing: how you heard about ORBES.');
    expect(missingList(['PHONE', 'BIRTH_DATE'])).toBe('your phone and your date of birth');
    expect(missingList(['PIECES'])).toBe('your favourite pieces');
    expect(missingList([])).toBe('');
    expect(missingList(['NAME', 'COUNTRY', 'CITY', 'ADDRESS', 'FINISHES'])).toBe('your name, your country, your city, your address and your favourite finishes');
  });

  it('says complete when nothing is missing, in the view and on the row', () => {
    expect(completionLine({ percent: 100, missing: [] })).toBe('Your profile is complete.');
    expect(completionRow({ percent: 100, missing: [] })).toBe('COMPLETE');
    expect(completionRow({ percent: 60, missing: ['PHONE'] })).toBe('60% COMPLETE');
    expect(completionRow({ percent: 0, missing: ['NAME'] })).toBe('0% COMPLETE');
  });

  it('names every item of the completion in the collector\'s words', () => {
    expect(Object.keys(ACCOUNT_PROFILE.item)).toEqual(['NAME', 'COUNTRY', 'BIRTH_DATE', 'CITY', 'ADDRESS', 'PHONE', 'INSTAGRAM', 'PIECES', 'FINISHES', 'HEARD']);
  });
});

describe('YOUR PROFILE: the date of birth (§3.1 P.8.2)', () => {
  it('offers DAY 1 to 31, MONTH JAN to DEC and YEAR from 13 years ago down to 1900, each with its word first', () => {
    const o = dobOptions('2026-10-05');
    expect(o.days[0]).toEqual({ value: '', label: 'DAY' });
    expect(o.days.slice(1).map((d) => d.label)).toEqual(Array.from({ length: 31 }, (_, i) => String(i + 1)));
    expect(o.days[1]).toEqual({ value: '01', label: '1' });
    expect(o.months.map((m) => m.label)).toEqual(['MONTH', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']);
    expect(o.months[12]).toEqual({ value: '12', label: 'DEC' });
    expect(o.years[0]).toEqual({ value: '', label: 'YEAR' });
    expect(o.years[1]).toEqual({ value: '2013', label: '2013' });
    expect(o.years[o.years.length - 1]).toEqual({ value: '1900', label: '1900' });
    expect(o.years).toHaveLength(1 + (2013 - 1900 + 1));
  });

  it('reads the three selects together: none, a part only, or the date', () => {
    expect(birthDateOf('', '', '')).toEqual({ kind: 'none' });
    expect(birthDateOf('14', '', '1994')).toEqual({ kind: 'partial' });
    expect(birthDateOf('', '03', '')).toEqual({ kind: 'partial' });
    expect(birthDateOf('14', '03', '1994')).toEqual({ kind: 'date', date: '1994-03-14' });
    // 31 April is offered (every month has 31 days): the server is the judge ('This date does not exist.').
    expect(birthDateOf('31', '04', '1994')).toEqual({ kind: 'date', date: '1994-04-31' });
  });

  it('writes a date of birth in words, as CONFIRM YOUR DATE OF BIRTH says it', () => {
    expect(birthDateWords('1994-03-14')).toBe('14 MARCH 1994');
    expect(ACCOUNT_PROFILE.birthConfirmLine(birthDateWords('1994-03-14'))).toBe('14 MARCH 1994. Once saved, only ORBES Client Services can change it.');
  });
});

describe('YOUR PROFILE: the phone (§3.1 P.8.2, the owner\'s choice: its code follows the country)', () => {
  it('offers every country with its code, « France +33 », by name, after Choose', () => {
    const o = codeOptions();
    expect(o[0]).toEqual({ value: '', label: 'Choose' });
    expect(o).toContainEqual({ value: 'FR', label: 'France +33' });
    expect(o).toContainEqual({ value: 'IT', label: 'Italy +39' });
    expect(o).toHaveLength(1 + COUNTRY_CODES.filter((c) => CALLING_CODES[c] !== undefined).length);
    const names = o.slice(1).map((x) => x.label);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('follows COUNTRY while the number is empty or the code was never changed by hand', () => {
    expect(followCountry({ code: '', codeChanged: false, number: '' }, 'FR')).toBe('FR');
    expect(followCountry({ code: 'FR', codeChanged: false, number: '6 12 34 56 78' }, 'IT')).toBe('IT');
    expect(followCountry({ code: 'GB', codeChanged: true, number: '' }, 'FR')).toBe('FR');
    // Changed by hand with a number typed: the code chosen stays.
    expect(followCountry({ code: 'GB', codeChanged: true, number: '7700 900123' }, 'FR')).toBe('GB');
    // No country (« Choose your country »): nothing to follow.
    expect(followCountry({ code: 'FR', codeChanged: false, number: '' }, '')).toBe('FR');
  });

  it('shows a saved phone again: grouped in twos for France, in threes otherwise; another code as saved', () => {
    expect(phoneDisplay('+33612345678', 'FR')).toBe('+33 6 12 34 56 78');
    expect(phoneNational('+33612345678', 'FR')).toBe('6 12 34 56 78');
    // Italy keeps its leading 0 (KEEPS_TRUNK_ZERO): shown again with it.
    expect(phoneDisplay('+390612345678', 'IT')).toBe('+39 0 612 345 678');
    expect(phoneDisplay('+14155550123', 'US')).toBe('+1 4 155 550 123');
    // Typed with its own +code, different from the country picked: kept as typed.
    expect(phoneDisplay('+447700900123', 'FR')).toBe('+447700900123');
    expect(phoneNational('+447700900123', 'FR')).toBe('+447700900123');
  });
});

describe('YOUR PROFILE: YOUR TASTES (§3.2 W.10.3)', () => {
  it('lists what the collection offers, then a choice it no longer shows at the end, pressed while held', () => {
    const v = view({ tastes: { pieces: [{ key: 'RING', label: 'RING', retired: false }], finishes: [{ key: 'SILVER', label: 'Silver', retired: true }, { key: 'GOLD', label: 'Gold', swatch: '#B88A3A', retired: false }] } });
    const g = tasteGroups(v, { pieces: ['RING'], finishes: ['SILVER', 'GOLD'] });
    expect(g.pieces.map((c) => [c.key, c.pressed, c.retired])).toEqual([
      ['BRACELET', false, false],
      ['RING', true, false],
    ]);
    expect(g.finishes.map((c) => [c.key, c.label, c.swatch, c.pressed, c.retired])).toEqual([
      ['BLUE', 'Blue', '#16224A', false, false],
      ['GOLD', 'Gold', '#B88A3A', true, false],
      ['SILVER', 'Silver', null, true, true],
    ]);
    // Unpressed, the retired choice is still shown until the profile is saved (then gone for good).
    expect(tasteGroups(v, { pieces: [], finishes: [] }).finishes.at(-1)).toMatchObject({ key: 'SILVER', pressed: false, retired: true });
  });

  it('shows no group with nothing to choose and nothing held', () => {
    const v = view({}, { options: { pieces: [], finishes: [], heard: [] } });
    expect(tasteGroups(v, { pieces: [], finishes: [] })).toEqual({ pieces: [], finishes: [] });
  });

  it('presses up to 30 of each kind: a 31st is refused, taking one off is always possible', () => {
    const thirty = Array.from({ length: 30 }, (_, i) => `K${i}`);
    expect(tasteToggle(thirty, 'K30')).toEqual({ keys: thirty, refused: true });
    expect(tasteToggle(thirty, 'K3')).toEqual({ keys: thirty.filter((k) => k !== 'K3'), refused: false });
    expect(tasteToggle([], 'RING')).toEqual({ keys: ['RING'], refused: false });
    expect(tasteToggle(['RING'], 'RING')).toEqual({ keys: [], refused: false });
  });
});

describe('YOUR PROFILE: the draft and what SAVE sends (§3.1 P.6.3, P.8.4)', () => {
  it('drafts a saved profile as it is: the phone\'s code its own, its national part grouped', () => {
    const v = view({
      firstName: 'Camille',
      lastName: 'Laurent',
      country: 'FR',
      city: 'Paris',
      phone: { country: 'FR', number: '+33612345678' },
      instagram: 'camille.l',
      heard: { optionId: OTHER, label: 'Other', other: 'A dinner in Lyon' },
      tastes: { pieces: [{ key: 'RING', label: 'RING', retired: false }], finishes: [] },
      version: 3,
    });
    expect(draftOf(v)).toEqual({
      firstName: 'Camille',
      lastName: 'Laurent',
      country: 'FR',
      city: 'Paris',
      phoneCode: 'FR',
      codeChanged: false,
      phoneNumber: '6 12 34 56 78',
      day: '',
      month: '',
      year: '',
      instagram: 'camille.l',
      heardId: OTHER,
      heardOther: 'A dinner in Lyon',
      pieces: ['RING'],
      finishes: [],
    });
    // No phone saved: the code is the country's.
    expect(draftOf(view({ country: 'IT' })).phoneCode).toBe('IT');
    expect(draftOf(view()).phoneCode).toBe('');
  });

  it('sends the whole profile with the version read, an empty field as null, Other\'s words only with Other', () => {
    const v = view({ version: 2 });
    const d = { ...draftOf(v), firstName: ' Camille ', lastName: 'Laurent', country: 'FR', city: '', phoneCode: 'FR', phoneNumber: '06 12 34 56 78', instagram: '@Camille.L', heardId: FRIEND, heardOther: 'kept nowhere', pieces: ['RING'], finishes: ['GOLD'] };
    expect(profileFromForm(d, v)).toEqual({
      version: 2,
      firstName: 'Camille',
      lastName: 'Laurent',
      country: 'FR',
      city: null,
      phone: { country: 'FR', number: '06 12 34 56 78' },
      instagram: '@Camille.L',
      heard: { optionId: FRIEND, other: null },
      tastes: { pieces: ['RING'], finishes: ['GOLD'] },
    });
    expect(profileFromForm({ ...d, heardId: OTHER, heardOther: ' A dinner ' }, v).heard).toEqual({ optionId: OTHER, other: 'A dinner' });
    expect(profileFromForm({ ...d, heardId: '' }, v).heard).toBeNull();
    expect(profileFromForm({ ...d, phoneNumber: '  ' }, v).phone).toBeNull();
    expect(heardIsOther(v, OTHER)).toBe(true);
    expect(heardIsOther(v, FRIEND)).toBe(false);
  });

  it('sends the date of birth only when it is entered: never once saved, never after Client Services removed it', () => {
    const d = { ...draftOf(view()), day: '14', month: '03', year: '1994' };
    expect(profileFromForm(d, view()).birthDate).toBe('1994-03-14');
    expect('birthDate' in profileFromForm({ ...d, day: '' }, view())).toBe(false);
    expect('birthDate' in profileFromForm(d, view({ birthDate: '1990-01-01', birthDateLocked: true }))).toBe(false);
    expect('birthDate' in profileFromForm(d, view({ birthDate: null, birthDateLocked: true }))).toBe(false);
  });

  it('cleans Instagram with the server\'s own rule', () => {
    expect(instagramFromInput).toBe(toInstagram);
    expect(instagramFromInput('https://www.instagram.com/Camille.L/?hl=fr')).toEqual({ ok: true, value: 'camille.l' });
  });

  it('names the field a refusal is about, so the focus goes there', () => {
    expect(refusalField('VALIDATION_FAILED', 'Enter your first name.')).toBe('firstName');
    expect(refusalField('VALIDATION_FAILED', 'Enter your last name.')).toBe('lastName');
    expect(refusalField('VALIDATION_FAILED', 'Choose your country.')).toBe('country');
    expect(refusalField('VALIDATION_FAILED', 'Choose the country code of your phone.')).toBe('phoneCode');
    expect(refusalField('VALIDATION_FAILED', 'This phone number is too short or too long.')).toBe('phoneNumber');
    expect(refusalField('VALIDATION_FAILED', 'Your city is 80 characters at most.')).toBe('city');
    expect(refusalField('VALIDATION_FAILED', 'This date does not exist.')).toBe('birthDate');
    expect(refusalField('VALIDATION_FAILED', 'Enter your Instagram username: letters, numbers, full stops and underscores, 30 at most.')).toBe('instagram');
    expect(refusalField('HEARD_UNAVAILABLE', 'This answer is no longer offered. Choose another.')).toBe('heard');
    expect(refusalField('TASTE_UNKNOWN', 'Choose among the pieces and finishes of the collection.')).toBe('tastes');
    expect(refusalField('RATE_LIMITED', 'Too many requests.')).toBeNull();
  });
});
