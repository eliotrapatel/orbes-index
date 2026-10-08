/**
 * YOUR ADDRESSES and an order's delivery address (plan NEXT LOT §3.6.B), their view-model (addresses-model.ts) and their
 * words (ACCOUNT_ADDRESSES, ORDERS.address, ORDERS.addressFields). Pure: no DOM. The sheets are driven in Chromium by
 * verify.orders.e2e.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { COUNTRY_CODES } from '../../src/shared/countries.js';
import { addressesSummary, addressInput, addressLines, addressProblem, countryOptions, countryPreselected, mayAddAddress, sameAddress, savedChoice } from '../../src/web/verify/addresses-model.js';
import { ACCOUNT_ADDRESSES, ORDERS } from '../../src/web/verify/copy.js';
import type { SavedAddress } from '../../src/web/verify/types.js';
import { brandForbiddenTerms, EXTRA_FORBIDDEN_EN, findForbidden } from '../docs/lexicon.js';

const saved = (extra: Partial<SavedAddress> = {}): SavedAddress => ({
  id: '5a5a5a5a-0000-4000-8000-000000000001',
  name: 'Jeanne Martin',
  address: '12 rue de la Paix\n75002 Paris',
  country: 'FR',
  phone: '+33 6 12 34 56 78',
  isDefault: true,
  ...extra,
});

describe('YOUR ADDRESSES (addresses-model.ts)', () => {
  it('says how many are saved in the account sheet\'s row, or NOT SET', () => {
    expect(addressesSummary([])).toBe('NOT SET');
    expect(addressesSummary(null)).toBe('NOT SET');
    expect(addressesSummary([saved()])).toBe('1 SAVED');
    expect(addressesSummary([saved(), saved({ id: 'x', isDefault: false })])).toBe('2 SAVED');
  });

  it('shows an address in lines: the name, each line as written, the country in English, the phone', () => {
    expect(addressLines(saved())).toEqual(['Jeanne Martin', '12 rue de la Paix', '75002 Paris', 'France', '+33 6 12 34 56 78']);
    expect(addressLines({ name: 'A', address: 'Line 1\n\n  Line 2  ', country: 'GB', phone: null })).toEqual(['A', 'Line 1', 'Line 2', 'United Kingdom']);
    // A choice of the address sheet: its name, its first line, its country.
    expect(savedChoice(saved())).toBe('Jeanne Martin · 12 rue de la Paix · France');
  });

  it('offers every country by its English name, \'Choose a country\' first; preselects the address\'s own, else the registration country', () => {
    const options = countryOptions();
    expect(options[0]).toEqual({ value: '', label: 'Choose a country' });
    expect(options.slice(1).map((o) => o.value).sort()).toEqual([...COUNTRY_CODES].sort());
    expect(options.find((o) => o.value === 'FR')!.label).toBe('France');
    const labels = options.slice(1).map((o) => o.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'en')));
    expect(countryPreselected('IT', 'FR')).toBe('IT');
    expect(countryPreselected(null, 'FR')).toBe('FR');
    expect(countryPreselected(null, null)).toBe('');
    expect(countryPreselected('XX', 'ZZ')).toBe('');
  });

  it('checks the four fields in the server\'s words, naming the field to correct; trims what it sends', () => {
    const ok = { name: ' Jeanne Martin ', address: ' 12 rue de la Paix \r\n\r\n 75002 Paris ', country: 'fr', phone: ' +33 6 12 34 56 78 ' };
    expect(addressProblem(ok)).toBeNull();
    expect(addressInput(ok)).toEqual({ name: 'Jeanne Martin', address: '12 rue de la Paix\n75002 Paris', country: 'FR', phone: '+33 6 12 34 56 78' });
    expect(addressProblem({ ...ok, name: '  ' })).toEqual({ message: 'Enter the name and the address.', field: 'name' });
    expect(addressProblem({ ...ok, address: '' })).toEqual({ message: 'Enter the name and the address.', field: 'address' });
    expect(addressProblem({ ...ok, country: '' })).toEqual({ message: 'Choose a country.', field: 'country' });
    for (const phone of ['', '06 12 34 56 78', '+33', '+33 6 12 34 56 78 90 12 34 56 78 90 12']) expect(addressProblem({ ...ok, phone }), phone).toEqual({ message: 'Enter a phone number with its country code.', field: 'phone' });
  });

  it('selects the saved address that is on the order; keeps at most five', () => {
    const current = { name: 'Jeanne  Martin', address: '12 rue de la Paix\n75002 Paris', country: 'FR', phone: '+33 6 12 34 56 78' };
    expect(sameAddress(saved(), current)).toBe(true);
    expect(sameAddress(saved(), { ...current, country: 'BE' })).toBe(false);
    expect(sameAddress(saved(), null)).toBe(false);
    expect(mayAddAddress([saved(), saved(), saved(), saved()])).toBe(true);
    expect(mayAddAddress([saved(), saved(), saved(), saved(), saved()])).toBe(false);
  });

  it('writes its words calmly: no exclamation mark, no word of BRAND §4.5', () => {
    const said = (v: unknown): string[] =>
      typeof v === 'string' ? [v] : typeof v === 'function' ? [String((v as (...a: unknown[]) => unknown)(2))] : v && typeof v === 'object' ? Object.values(v).flatMap(said) : [];
    const words = [ACCOUNT_ADDRESSES, ORDERS.address, ORDERS.addressFields].flatMap(said).join('\n');
    expect(words).toContain('YOUR ADDRESSES');
    expect(words).not.toContain('!');
    expect(findForbidden(words, [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN])).toEqual([]);
    expect(ACCOUNT_ADDRESSES.max).toBe(5);
  });
});
