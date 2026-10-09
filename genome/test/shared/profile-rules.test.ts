/**
 * The profile's shared rules (plan CUSTOMER INTELLIGENCE §3.1 P.16, §3.2 W.5, step 1.2; src/shared/profile-rules.ts),
 * read by the server and the collector app alike.
 */
import { describe, expect, it } from 'vitest';
import { COUNTRY_CODES } from '../../src/shared/countries.js';
import {
  ageBand,
  ageOn,
  birthDateProblem,
  CALLING_CODES,
  cleanName,
  completion,
  COMPLETION_KEYS,
  E164_RE,
  KEEPS_TRUNK_ZERO,
  latestBirthDate,
  tasteKey,
  TASTES_MAX,
  toE164,
  toInstagram,
} from '../../src/shared/profile-rules.js';

describe('the profile\'s rules (plan CUSTOMER INTELLIGENCE §3.1)', () => {
  it('cleanName: trimmed and NFC, any script, 1 to 50 characters, no control character nor < >; empty is null', () => {
    expect(cleanName('  Camille ')).toEqual({ ok: true, value: 'Camille' });
    expect(cleanName('Zoe\u0308')).toEqual({ ok: true, value: 'Zoë' });
    for (const n of ['Jean Paul Le Gall', 'Ле Галль', '王小明', 'محمد', "O'Brien", 'Anne-Sophie']) expect(cleanName(n), n).toEqual({ ok: true, value: n });
    expect(cleanName('x'.repeat(50))).toEqual({ ok: true, value: 'x'.repeat(50) });
    expect(cleanName('x'.repeat(51))).toEqual({ ok: false, problem: 'TOO_LONG' });
    // Characters, not UTF-16 units.
    expect(cleanName('😀'.repeat(50))).toMatchObject({ ok: true });
    for (const n of ['Jane<', 'a>b', 'Jane\nDoe', 'Jane\tDoe', 'Jane\u0085', 'Jane\u2028Doe', 'Jane\u0000']) expect(cleanName(n), JSON.stringify(n)).toEqual({ ok: false, problem: 'INVALID' });
    for (const n of ['', '   ', null, undefined]) expect(cleanName(n), String(n)).toEqual({ ok: true, value: null });
    expect(cleanName(42)).toEqual({ ok: false, problem: 'INVALID' });
  });

  it('toE164: the digits after the country\'s code, one trunk 0 dropped (kept in IT, SM and VA), a typed +code kept, letters refused, too short and too long refused', () => {
    expect(toE164('FR', '06 12 34 56 78')).toEqual({ ok: true, e164: '+33612345678' });
    expect(toE164('FR', '6.12.34.56.78')).toEqual({ ok: true, e164: '+33612345678' });
    expect(toE164('IT', '06 1234 5678')).toEqual({ ok: true, e164: '+390612345678' });
    expect(toE164('SM', '0549 123456')).toEqual({ ok: true, e164: '+3780549123456' });
    expect(toE164('VA', '06 6988 1234')).toEqual({ ok: true, e164: '+390669881234' });
    expect(toE164('GB', '07700 900123')).toEqual({ ok: true, e164: '+447700900123' });
    expect(toE164('US', '(415) 555-0123')).toEqual({ ok: true, e164: '+14155550123' });
    // A typed +code wins over the select's, which stays the phone's country.
    expect(toE164('FR', '+33 6 12 34 56 78')).toEqual({ ok: true, e164: '+33612345678' });
    expect(toE164('FR', '+44 7700 900123')).toEqual({ ok: true, e164: '+447700900123' });
    // Full-width digits read as digits.
    expect(toE164('JP', '０９０ １２３４ ５６７８')).toEqual({ ok: true, e164: '+819012345678' });
    // Only one trunk 0 is dropped.
    expect(toE164('FR', '006 12 34 56 78')).toEqual({ ok: true, e164: '+330612345678' });
    for (const n of ['06 12 AB 56 78', '+33 6 12 34 56 7x', '06/12/34/56/78', '#123']) expect(toE164('FR', n), n).toEqual({ ok: false, problem: 'NOT_DIGITS' });
    for (const n of ['0612', '1234', '', '0', '+', '+3361', '+33 6 12 34 56 78 90 12 34', '+0612345678']) expect(toE164('FR', n), n).toEqual({ ok: false, problem: 'LENGTH' });
    expect(toE164('ZZ', '06 12 34 56 78')).toEqual({ ok: false, problem: 'NO_CODE' });
    expect(toE164(null, '06 12 34 56 78')).toEqual({ ok: false, problem: 'NO_CODE' });
    expect(toE164('FR', 612345678)).toEqual({ ok: false, problem: 'NOT_DIGITS' });
  });

  it('CALLING_CODES covers every country of countries.ts, and Kosovo, each 1 to 3 digits; KEEPS_TRUNK_ZERO is Italy, San Marino and the Vatican', () => {
    for (const c of COUNTRY_CODES) expect(CALLING_CODES[c], c).toMatch(/^[1-9][0-9]{0,2}$/);
    expect(Object.keys(CALLING_CODES).filter((c) => !COUNTRY_CODES.includes(c))).toEqual(['XK']);
    expect(CALLING_CODES.XK).toBe('383');
    expect([CALLING_CODES.FR, CALLING_CODES.GB, CALLING_CODES.US, CALLING_CODES.CA, CALLING_CODES.IT, CALLING_CODES.VA, CALLING_CODES.CH, CALLING_CODES.JP]).toEqual(['33', '44', '1', '1', '39', '39', '41', '81']);
    expect([...KEEPS_TRUNK_ZERO].sort()).toEqual(['IT', 'SM', 'VA']);
    expect(E164_RE.test('+33612345678')).toBe(true);
  });

  it('toInstagram: the username in lower case from an @, capitals or a pasted profile link; spaces, accents and other signs refused', () => {
    expect(toInstagram('@Eliot.R')).toEqual({ ok: true, value: 'eliot.r' });
    expect(toInstagram('https://www.instagram.com/eliot.r/?hl=fr')).toEqual({ ok: true, value: 'eliot.r' });
    expect(toInstagram('instagram.com/eliot_r')).toEqual({ ok: true, value: 'eliot_r' });
    expect(toInstagram('http://instagram.com/Eliot_R/')).toEqual({ ok: true, value: 'eliot_r' });
    expect(toInstagram(' camille.dl ')).toEqual({ ok: true, value: 'camille.dl' });
    expect(toInstagram('a'.repeat(30))).toEqual({ ok: true, value: 'a'.repeat(30) });
    for (const v of ['eliot r', 'éliot', 'eliot-r', 'a'.repeat(31), '@', '@@eliot', 'https://www.instagram.com/', 'https://example.com/eliot', 'eliot/r']) {
      expect(toInstagram(v), v).toEqual({ ok: false, problem: 'INVALID' });
    }
    for (const v of ['', '  ', null, undefined]) expect(toInstagram(v), String(v)).toEqual({ ok: true, value: null });
  });

  it('birthDateProblem: a real date from 1900 to 13 years before today in Paris, 13 years exactly taken; 29 February only in a leap year', () => {
    expect(birthDateProblem('2013-10-09', '2026-10-09')).toBeNull();
    expect(birthDateProblem('2013-10-10', '2026-10-09')).toBe('OUT_OF_RANGE');
    expect(birthDateProblem('1900-01-01', '2026-10-09')).toBeNull();
    expect(birthDateProblem('1899-12-31', '2026-10-09')).toBe('OUT_OF_RANGE');
    expect(birthDateProblem('2030-01-01', '2026-10-09')).toBe('OUT_OF_RANGE');
    expect(birthDateProblem('2000-02-29', '2026-10-09')).toBeNull();
    expect(birthDateProblem('2001-02-29', '2026-10-09')).toBe('NOT_A_DATE');
    expect(birthDateProblem('1990-04-31', '2026-10-09')).toBe('NOT_A_DATE');
    expect(birthDateProblem('1990-13-01', '2026-10-09')).toBe('NOT_A_DATE');
    for (const v of ['14/03/1994', '1994-3-14', '', null, 19940314]) expect(birthDateProblem(v, '2026-10-09'), String(v)).toBe('INVALID');
    // On 29 February of a leap year, the limit is 28 February 13 years before (a common year).
    expect(latestBirthDate('2028-02-29')).toBe('2015-02-28');
    expect(birthDateProblem('2015-02-28', '2028-02-29')).toBeNull();
    expect(birthDateProblem('2015-03-01', '2028-02-29')).toBe('OUT_OF_RANGE');
  });

  it('ageOn and ageBand: the age the day before, the day of the birthday and on 29 February; the bands staff read', () => {
    expect(ageOn('1994-03-14', '2026-03-13')).toBe(31);
    expect(ageOn('1994-03-14', '2026-03-14')).toBe(32);
    expect(ageOn('2000-02-29', '2025-02-27')).toBe(24);
    expect(ageOn('2000-02-29', '2025-02-28')).toBe(25);
    expect(ageOn('2000-02-29', '2028-02-28')).toBe(27);
    expect(ageOn('2000-02-29', '2028-02-29')).toBe(28);
    expect([13, 17, 18, 24, 25, 34, 35, 44, 45, 54, 55, 64, 65, 99].map(ageBand)).toEqual([
      'under18', 'under18', '18-24', '18-24', '25-34', '25-34', '35-44', '35-44', '45-54', '45-54', '55-64', '55-64', '65plus', '65plus',
    ]);
  });

  it('completion: ten items of equal weight, rounded, the missing ones in order; tastes with nothing to choose left out of the count', () => {
    const offered = { pieces: [{ key: 'RING' }], finishes: [{ key: 'GOLD' }] };
    const none = { pieces: [], finishes: [] };
    const empty = { firstName: null, lastName: null, birthDate: null, city: null, phone: null, instagram: null, heard: null, tastes: { pieces: [], finishes: [] } };
    expect(COMPLETION_KEYS).toEqual(['NAME', 'COUNTRY', 'BIRTH_DATE', 'CITY', 'ADDRESS', 'PHONE', 'INSTAGRAM', 'PIECES', 'FINISHES', 'HEARD']);
    // No profile row: everything missing but the country the account holds.
    expect(completion(null, { country: null }, false, offered)).toEqual({ percent: 0, missing: [...COMPLETION_KEYS] });
    expect(completion(null, { country: 'FR' }, false, offered)).toEqual({ percent: 10, missing: COMPLETION_KEYS.filter((k) => k !== 'COUNTRY') });
    // The name counts with both names only.
    expect(completion({ ...empty, firstName: 'Camille' }, { country: 'FR' }, false, offered).missing).toContain('NAME');
    // Every item, one at a time.
    const full = { firstName: 'Camille', lastName: 'Durand', birthDate: '1994-03-14', city: 'Lyon', phone: { country: 'FR', number: '+33612345678' }, instagram: 'camille.dl', heard: { optionId: 'x' }, tastes: { pieces: [{}], finishes: [{}] } };
    expect(completion(full, { country: 'FR' }, true, offered)).toEqual({ percent: 100, missing: [] });
    const without: [Partial<typeof full>, string][] = [
      [{ birthDate: null as never }, 'BIRTH_DATE'], [{ city: null as never }, 'CITY'], [{ phone: null as never }, 'PHONE'], [{ instagram: null as never }, 'INSTAGRAM'],
      [{ heard: null as never }, 'HEARD'], [{ tastes: { pieces: [], finishes: [{}] } }, 'PIECES'], [{ tastes: { pieces: [{}], finishes: [] } }, 'FINISHES'],
    ];
    for (const [change, key] of without) expect(completion({ ...full, ...change }, { country: 'FR' }, true, offered), key).toEqual({ percent: 90, missing: [key] });
    expect(completion(full, { country: 'FR' }, false, offered)).toEqual({ percent: 90, missing: ['ADDRESS'] });
    expect(completion(full, { country: null }, true, offered)).toEqual({ percent: 90, missing: ['COUNTRY'] });
    // The owner's example: 60%, the phone, the date of birth and the Instagram missing… with the address and the city.
    expect(completion({ ...full, phone: null, birthDate: null, instagram: null, city: null }, { country: 'FR' }, true, offered)).toEqual({ percent: 60, missing: ['BIRTH_DATE', 'CITY', 'PHONE', 'INSTAGRAM'] });
    // Nothing to choose: the tastes leave the count (8 items); a retired choice held still counts its item.
    expect(completion({ ...full, tastes: { pieces: [], finishes: [] } }, { country: 'FR' }, true, none)).toEqual({ percent: 100, missing: [] });
    expect(completion({ ...empty, firstName: 'C', lastName: 'D' }, { country: 'FR' }, false, none)).toEqual({ percent: 25, missing: ['BIRTH_DATE', 'CITY', 'ADDRESS', 'PHONE', 'INSTAGRAM', 'HEARD'] });
    expect(completion({ ...full, tastes: { pieces: [{}], finishes: [] } }, { country: 'FR' }, true, none)).toEqual({ percent: 100, missing: [] });
    // Rounded: 1 of 9 counted is 11%, 2 of 3… never 100 while one is missing.
    expect(completion({ ...empty, tastes: { pieces: [], finishes: [] } }, { country: 'FR' }, false, { pieces: [{}], finishes: [] }).percent).toBe(11);
    expect(completion({ ...full, heard: null }, { country: 'FR' }, true, offered).percent).toBeLessThan(100);
  });

  it('tasteKey: trimmed, inner spaces made single, in capitals, 1 to 60 characters, no control character', () => {
    expect(tasteKey('  Rose   gold ')).toBe('ROSE GOLD');
    expect(tasteKey('Gold')).toBe('GOLD');
    expect(tasteKey('GOLD')).toBe('GOLD');
    expect(tasteKey('signet\tring')).toBe('SIGNET RING');
    expect(tasteKey('EAU DE PARFUM 100 ML')).toBe('EAU DE PARFUM 100 ML');
    expect(tasteKey('x'.repeat(60))).toBe('X'.repeat(60));
    for (const v of ['', '   ', 'x'.repeat(61), 'Gold\u0000', null, 3]) expect(tasteKey(v), String(v)).toBeNull();
    expect(TASTES_MAX).toBe(30);
  });
});
