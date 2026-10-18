/**
 * The forms of the account (the OWNERSHIP panel's sign-in, account creation,
 * recovery, claim and transfer codes; MY PIECES' change of password): a
 * labelled field with its hint, and a form whose submit runs one request at a
 * time, says what went wrong in one sentence under its fields, and puts the
 * keyboard focus back on the field to correct (or on its button).
 *
 * Server messages are shown as they come: they are written for customers and
 * never carry internal detail. Typed secrets stay in the fields only.
 */
import { isCountryCode } from '../../../shared/countries.js';
import { h } from '../../shared/dom.js';
import { ApiError } from '../api.js';
import { PIECES, REQUEST_ERRORS, SIGN_UP } from '../copy.js';
import { isDesktop } from '../../shared/desktop.js';
import type { SessionStore } from '../session.js';

/** Minimum password length (PLATFORM-CONTRACTS §2.9). */
export const MIN_PASSWORD = 12;

/** A refusal the page itself states (an empty or short field), before any request. */
export class FormError extends Error {}

/**
 * One sentence for a failed request: the network, the rate limit, an ended session, a 5xx, else the server's own words.
 * A sign-in refused for a wrong email or password is a 401 too: it reads as the server wrote it, never as an ended session.
 */
export function messageOf(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.isNetwork) return REQUEST_ERRORS.network;
    if (e.status === 429) return REQUEST_ERRORS.rateLimited;
    if (e.status === 401) return e.code === 'INVALID_CREDENTIALS' ? e.message : 'Your session has ended. Please sign in again.';
    if (e.status >= 500) return 'This could not be completed just now. Please try again in a moment.';
    return e.message;
  }
  return 'This could not be completed. Please try again.';
}

/** A field: its label (10 px, the display face), the input, and a hint the input is described by. */
export function field(id: string, label: string, input: HTMLInputElement, hint?: string): HTMLElement {
  input.id = id;
  input.classList.add('field__input');
  const hintEl = hint ? h('span', { class: 'field__hint', id: `${id}-hint`, text: hint }) : null;
  if (hintEl) input.setAttribute('aria-describedby', hintEl.id);
  return h('div', { class: 'field' }, h('label', { class: 'field__label', attrs: { for: id }, text: label }), input, hintEl);
}

/**
 * A select in the vault's field style (CREATE ACCOUNT on a LIVE RELEASE's pages, plan CUSTOMER INTELLIGENCE §3.1 P.4.1):
 * its label, the native select with the line beneath and a chevron of its own at its right, and the hint it is
 * described by. Its own classes: nothing of NOCTURNE's select reaches the vault's look.
 */
export function selectField(id: string, label: string, options: readonly { value: string; label: string }[], value: string, hint?: string): { el: HTMLElement; select: HTMLSelectElement } {
  const select = h('select', { class: 'field__input field__select-input', id, attrs: { name: id } }, ...options.map((o) => h('option', { attrs: { value: o.value }, text: o.label })));
  select.value = value;
  const hintEl = hint ? h('span', { class: 'field__hint', id: `${id}-hint`, text: hint }) : null;
  if (hintEl) select.setAttribute('aria-describedby', hintEl.id);
  return {
    el: h('div', { class: 'field' }, h('label', { class: 'field__label', attrs: { for: id }, text: label }), h('div', { class: 'field__select' }, select), hintEl),
    select,
  };
}

/** What CREATE ACCOUNT holds when it is sent (plan CUSTOMER INTELLIGENCE §3.1 P.7). */
export interface SignUpValues {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  country: string;
}

/**
 * CREATE ACCOUNT's checks before it is sent, in the form's order (§3.1 P.7): the first name, the last name, the email,
 * the password's length, then the country; the first that fails, with the field it names, else null. The server checks
 * the same and says the rest (a name too long, an email taken).
 */
export function signUpProblem(v: SignUpValues): { message: string; field: keyof SignUpValues } | null {
  if (!v.firstName.trim()) return { message: SIGN_UP.noFirstName, field: 'firstName' };
  if (!v.lastName.trim()) return { message: SIGN_UP.noLastName, field: 'lastName' };
  if (!v.email.trim()) return { message: 'Enter your email address.', field: 'email' };
  if (v.password.length < MIN_PASSWORD) return { message: `Choose a password of at least ${MIN_PASSWORD} characters.`, field: 'password' };
  if (!isCountryCode(v.country)) return { message: SIGN_UP.noCountry, field: 'country' };
  return null;
}

/**
 * A form of `fields` and its submit button (the hairline button, block wide). One submit at a time; a failure
 * (a FormError, or the request's) is said under the fields (`role="alert"`), and a 401 ends the session on the page.
 */
export function accountForm(session: SessionStore, name: string, fields: HTMLElement[], submitLabel: string, onSubmit: () => Promise<void>): HTMLFormElement {
  const error = h('p', { class: 'form__error', attrs: { role: 'alert', hidden: true } });
  const submit = h('button', { class: 'btn btn--block', attrs: { type: 'submit', 'aria-busy': 'false' }, text: submitLabel });
  const form = h('form', { class: `form form--${name}`, attrs: { novalidate: true, 'aria-label': submitLabel.toLowerCase() } }, ...fields, error, submit);
  return wireForm(form, submit, error, session, onSubmit);
}

/**
 * The same form in NOCTURNE's pieces (C39): its fields underlined on the dark (views/nocturne.ts field()), the failure
 * said under them (`.err`), then the submit, the ivory button, beside `beside` (a hairline CANCEL) when given.
 */
export function nocturneForm(
  session: SessionStore,
  name: string,
  fields: HTMLElement[],
  submitLabel: string,
  onSubmit: () => Promise<void>,
  beside?: HTMLElement,
): HTMLFormElement {
  const error = h('p', { class: 'n-err form__error', attrs: { role: 'alert', hidden: true } });
  const submit = h('button', { class: 'n-g n-btn', attrs: { type: 'submit', 'aria-busy': 'false' }, text: submitLabel });
  const actions = beside ? h('div', { class: 'n-duo n-form__actions' }, submit, beside) : h('div', { class: 'n-form__actions' }, submit);
  const form = h('form', { class: `n-form form--${name}`, attrs: { novalidate: true, 'aria-label': submitLabel.toLowerCase() } }, ...fields, error, actions);
  return wireForm(form, submit, error, session, onSubmit);
}

/** The ids given to a form's sentence placed under its field (desktop). */
let errorIds = 0;

/**
 * Desktop (BRIEF §10.22): on a computer, the sentence of a refused form stands under the field to correct (two
 * fields side by side: under their row), and that field is described by it (`aria-describedby`); corrected (typed in,
 * chosen), the field is no longer marked and the sentence goes. Returns how to put the sentence back at the form's foot,
 * where a phone keeps it (and where a refusal without a field is said); null when nothing was moved.
 */
function placeUnderField(form: HTMLFormElement, error: HTMLElement): (() => void) | null {
  if (!isDesktop()) return null;
  const input = form.querySelector<HTMLElement>('[aria-invalid="true"]');
  const group = input?.closest<HTMLElement>('.n-fld-group, .field') ?? null;
  if (!input || !group || !form.contains(group)) return null;
  const pairRow = group.parentElement?.matches('.d-acct__pair, .d-acct__grid2') ? group.parentElement : null;
  const home = { parent: error.parentNode, next: error.nextSibling };
  if (!error.id) error.id = `form-error-${++errorIds}`;
  (pairRow ?? group).after(error);
  const before = input.getAttribute('aria-describedby');
  input.setAttribute('aria-describedby', before ? `${before} ${error.id}` : error.id);
  let undone = false;
  const undo = () => {
    if (undone) return;
    undone = true;
    input.removeEventListener('input', corrected);
    if (before === null) input.removeAttribute('aria-describedby');
    else input.setAttribute('aria-describedby', before);
    if (home.parent && error.isConnected) home.parent.insertBefore(error, home.next && home.next.parentNode === home.parent ? home.next : null);
  };
  const corrected = () => {
    input.removeAttribute('aria-invalid');
    error.hidden = true;
    error.textContent = '';
    undo();
  };
  input.addEventListener('input', corrected);
  return undo;
}

/** One submit at a time; a failure said in `error`, focus on the field to correct (or the button); a 401 ends the session. */
function wireForm(form: HTMLFormElement, submit: HTMLButtonElement, error: HTMLElement, session: SessionStore, onSubmit: () => Promise<void>): HTMLFormElement {
  let unplace: (() => void) | null = null;
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (submit.disabled) return;
    void (async () => {
      unplace?.();
      unplace = null;
      error.hidden = true;
      error.textContent = '';
      for (const f of Array.from(form.querySelectorAll('[aria-invalid]'))) f.removeAttribute('aria-invalid');
      submit.disabled = true;
      submit.setAttribute('aria-busy', 'true');
      // Desktop (BRIEF §10.22): the main button reads ONE MOMENT… while it is pending, at its own width.
      const label = isDesktop() && submit.classList.contains('n-btn') ? submit.textContent : null;
      if (label !== null) {
        submit.style.minWidth = `${submit.offsetWidth}px`;
        submit.textContent = PIECES.loading;
      }
      try {
        await onSubmit();
      } catch (e) {
        session.noteError(e);
        error.textContent = e instanceof FormError ? e.message : messageOf(e);
        unplace = placeUnderField(form, error);
        error.hidden = false;
        (form.querySelector<HTMLElement>('[aria-invalid="true"]') ?? submit).focus();
      } finally {
        submit.disabled = false;
        submit.setAttribute('aria-busy', 'false');
        // Its words back, unless the step changed them meanwhile (CONFIRM YOUR DATE OF BIRTH).
        if (label !== null) {
          if (submit.textContent === PIECES.loading) submit.textContent = label;
          submit.style.minWidth = '';
        }
      }
    })();
  });
  return form;
}
