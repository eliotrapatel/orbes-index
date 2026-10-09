/**
 * YOUR ADDRESSES and an order's delivery address (plan NEXT LOT §3.6.B), their view-model: the account sheet's row line,
 * an address in lines, the COUNTRY select's options, and the four fields checked in the server's words before it says
 * them. Pure (no DOM) and unit-tested (verify.addresses.test.ts); the views are views/address.ts and views/account.ts.
 *
 * An address is a NAME, the ADDRESS lines as written on the parcel, a COUNTRY (ISO 3166-1 alpha-2, src/shared/countries.ts,
 * named in English) and a PHONE with its country code; all four are asked of the collector.
 */
import { COUNTRY_CODES, countryName, isCountryCode, PHONE_RE } from '../../shared/countries.js';
import { ACCOUNT_ADDRESSES, ORDERS } from './copy.js';
import type { DeliveryAddressInput, SavedAddress } from './types.js';

/** YOUR ADDRESSES' line in the account sheet: `2 SAVED`, or NOT SET. */
export function addressesSummary(list: readonly SavedAddress[] | null | undefined): string {
  const n = Array.isArray(list) ? list.length : 0;
  return n > 0 ? ACCOUNT_ADDRESSES.count(n) : ACCOUNT_ADDRESSES.notSet;
}

/**
 * An address in lines: the name, each line as written (blank ones left out), the country's English name (not twice when
 * the last line already names it), the phone.
 */
export function addressLines(a: Pick<DeliveryAddressInput, 'name' | 'address'> & { country?: string | null; phone?: string | null }): string[] {
  const lines = a.address
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const country = a.country ? countryName(a.country) : null;
  const named = country !== null && lines.length > 0 && lines[lines.length - 1]!.toLowerCase() === country.toLowerCase();
  return [a.name.trim(), ...lines, ...(country && !named ? [country] : []), ...(a.phone ? [a.phone.trim()] : [])].filter(Boolean);
}

/** A saved address as a choice of the address sheet: its name, its first line and its country. */
export function savedChoice(a: SavedAddress): string {
  const first = a.address.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  return [a.name.trim(), first, countryName(a.country)].filter(Boolean).join(' · ');
}

/**
 * COUNTRY's options: 'Choose a country' first (or `first`: CREATE ACCOUNT's 'Choose your country'), then every country
 * by its English name, in that name's order.
 */
export function countryOptions(first: string = ORDERS.addressFields.chooseCountry): { value: string; label: string }[] {
  const named = COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code) })).sort((a, b) => a.label.localeCompare(b.label, 'en'));
  return [{ value: '', label: first }, ...named];
}

/** The country COUNTRY opens on: the address's own, else the account's registration country, else none (''). */
export function countryPreselected(current: string | null | undefined, registration: string | null | undefined): string {
  if (isCountryCode(current)) return current;
  if (isCountryCode(registration)) return registration;
  return '';
}

/** The four fields as typed. */
export interface AddressForm {
  name: string;
  address: string;
  country: string;
  phone: string;
}

/** The four fields as the server takes them: trimmed, the lines kept one each. */
export function addressInput(v: AddressForm): DeliveryAddressInput {
  return {
    name: v.name.trim(),
    address: v.address
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n'),
    country: v.country.trim().toUpperCase(),
    phone: v.phone.trim(),
  };
}

/**
 * What is wrong with the four fields, in the server's words (services/addresses.ts checkAddress), and the field to
 * correct; null when they may be sent.
 */
export function addressProblem(v: AddressForm): { message: string; field: keyof AddressForm } | null {
  const F = ORDERS.addressFields;
  const a = addressInput(v);
  if (!a.name) return { message: F.nameAndAddress, field: 'name' };
  if (!a.address) return { message: F.nameAndAddress, field: 'address' };
  if (!isCountryCode(a.country)) return { message: F.countryMissing, field: 'country' };
  if (!PHONE_RE.test(a.phone)) return { message: F.phoneInvalid, field: 'phone' };
  return null;
}

/** Whether a saved address is the one on the order (the sheet selects it). */
export function sameAddress(saved: SavedAddress, current: { name: string; address: string; country: string | null; phone: string | null } | null): boolean {
  if (!current) return false;
  const norm = (t: string | null) => (t ?? '').replace(/\s+/g, ' ').trim();
  return norm(saved.name) === norm(current.name) && norm(saved.address) === norm(current.address) && saved.country === current.country && norm(saved.phone) === norm(current.phone);
}

/** Whether another address may be added (at most ACCOUNT_ADDRESSES.max). */
export function mayAddAddress(list: readonly SavedAddress[]): boolean {
  return list.length < ACCOUNT_ADDRESSES.max;
}
