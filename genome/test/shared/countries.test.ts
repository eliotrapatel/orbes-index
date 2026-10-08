import { describe, expect, it } from 'vitest';
import { COUNTRY_CODES, countryName, isCountryCode, PHONE_RE } from '../../src/shared/countries.js';

describe('the countries a piece ships to (plan NEXT LOT §3.6.B, « any country »)', () => {
  it('lists every officially assigned ISO 3166-1 alpha-2 code once, in order', () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    expect([...COUNTRY_CODES].sort()).toEqual([...COUNTRY_CODES]);
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    for (const c of COUNTRY_CODES) expect(c, c).toMatch(/^[A-Z]{2}$/);
    for (const c of ['FR', 'GB', 'US', 'CH', 'JP', 'AE', 'MC']) expect(isCountryCode(c), c).toBe(true);
    for (const c of ['fr', 'FRA', 'UK', 'EU', 'ZZ', '', null, 33]) expect(isCountryCode(c), String(c)).toBe(false);
  });

  it('names each country in English', () => {
    expect(countryName('FR')).toBe('France');
    expect(countryName('GB')).toBe('United Kingdom');
    expect(countryName('CH')).toBe('Switzerland');
    for (const c of COUNTRY_CODES) expect(countryName(c).length, c).toBeGreaterThan(1);
  });

  it('takes a phone with its country code, as the CHECK of migration 0039 does', () => {
    for (const p of ['+33 6 12 34 56 78', '+44 20 7946 0000', '+1 (212) 555-0100', '+41.79.123.45.67', '+336123']) expect(PHONE_RE.test(p), p).toBe(true);
    for (const p of ['06 12 34 56 78', '+33', '+ 33 6 12 34 56 78', '+33 6 12 34 56 78 90 12 34 56 78 90', '+33 6 12/34', '33612345678']) expect(PHONE_RE.test(p), p).toBe(false);
  });
});
