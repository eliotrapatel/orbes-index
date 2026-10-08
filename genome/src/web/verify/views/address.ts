/**
 * The delivery address's four fields (plan NEXT LOT §3.6.B), in NOCTURNE's fields underlined on the dark, shared by the
 * order's address sheet (views/order-sheet.ts) and YOUR ADDRESSES in the account sheet (views/account.ts):
 *
 *   NAME                                    one line, 200 characters, autocomplete `name`
 *   ADDRESS                                 three rows, 1,000 characters, autocomplete `street-address`
 *   As it is written on the parcel, one line each.
 *   COUNTRY                       ⌄         every country by its English name ('Choose a country' first), the
 *                                           address's own or the account's registration country preselected
 *   PHONE                                   autocomplete `tel`
 *   For the carrier, with the country code: +33 6 12 34 56 78.
 *
 * What is wrong is said in the server's words before it says them (addresses-model.ts addressProblem), the field to
 * correct marked (aria-invalid) for the form to put the focus on it.
 */
import { h } from '../../shared/dom.js';
import { addressInput, addressProblem, countryOptions, countryPreselected, type AddressForm } from '../addresses-model.js';
import { ORDERS } from '../copy.js';
import type { DeliveryAddressInput } from '../types.js';
import { FormError } from './forms.js';
import { field, selectField } from './nocturne.js';

/** The fields of an address and how to read them back. */
export interface AddressFields {
  /** The four fields, in their order. */
  els: HTMLElement[];
  /** The address as typed, checked: a FormError in the server's words, its field marked, when it cannot be sent. */
  read(): DeliveryAddressInput;
}

/** Limits of the fields (services/addresses.ts ADDRESS_LIMITS). */
const LIMITS = Object.freeze({ name: 200, address: 1000, phone: 32 });

/**
 * The four fields, their ids under `prefix`, filled with `initial` (an address to edit) and COUNTRY on its country or the
 * account's registration country (`registration`).
 */
export function addressFields(prefix: string, initial: { name?: string; address?: string; country?: string | null; phone?: string | null } | null, registration: string | null): AddressFields {
  const F = ORDERS.addressFields;
  const name = h('input', { attrs: { type: 'text', name: 'name', autocomplete: 'name', maxlength: LIMITS.name, required: true } });
  name.value = initial?.name ?? '';
  const phone = h('input', { attrs: { type: 'tel', name: 'phone', autocomplete: 'tel', maxlength: LIMITS.phone, required: true, inputmode: 'tel' } });
  phone.value = initial?.phone ?? '';
  const areaId = `${prefix}-address`;
  const area = h('textarea', {
    class: 'n-fld__input n-write__area n-address__area',
    id: areaId,
    attrs: { name: 'address', rows: 3, maxlength: LIMITS.address, required: true, autocomplete: 'street-address', 'aria-describedby': `${areaId}-hint` },
  });
  area.value = initial?.address ?? '';
  const country = selectField(`${prefix}-country`, F.country, countryOptions(), countryPreselected(initial?.country, registration));
  country.select.setAttribute('autocomplete', 'country');
  const inputs: Record<keyof AddressForm, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = { name, address: area, country: country.select, phone };
  return {
    els: [
      field(`${prefix}-name`, F.name, name),
      h(
        'div',
        { class: 'n-fld-group' },
        h('label', { class: 'n-fld', attrs: { for: areaId } }, h('span', { class: 'n-g n-lab', text: F.address })),
        area,
        h('p', { class: 'n-sm n-fld__hint', id: `${areaId}-hint`, text: F.addressHint }),
      ),
      country.el,
      field(`${prefix}-phone`, F.phone, phone, F.phoneHint),
    ],
    read: () => {
      const v: AddressForm = { name: name.value, address: area.value, country: country.select.value, phone: phone.value };
      const problem = addressProblem(v);
      if (problem) {
        inputs[problem.field].setAttribute('aria-invalid', 'true');
        throw new FormError(problem.message);
      }
      return addressInput(v);
    },
  };
}
