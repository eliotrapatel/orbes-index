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
import { h } from '../../shared/dom.js';
import { ApiError } from '../api.js';
import { REQUEST_ERRORS } from '../copy.js';
import type { SessionStore } from '../session.js';

/** Minimum password length (PLATFORM-CONTRACTS §2.9). */
export const MIN_PASSWORD = 12;

/** A refusal the page itself states (an empty or short field), before any request. */
export class FormError extends Error {}

/** One sentence for a failed request: the network, the rate limit, an ended session, a 5xx, else the server's own words. */
export function messageOf(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.isNetwork) return REQUEST_ERRORS.network;
    if (e.status === 429) return REQUEST_ERRORS.rateLimited;
    if (e.status === 401) return 'Your session has ended. Please sign in again.';
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
 * A form of `fields` and its submit button (the hairline button, block wide). One submit at a time; a failure
 * (a FormError, or the request's) is said under the fields (`role="alert"`), and a 401 ends the session on the page.
 */
export function accountForm(session: SessionStore, name: string, fields: HTMLElement[], submitLabel: string, onSubmit: () => Promise<void>): HTMLFormElement {
  const error = h('p', { class: 'form__error', attrs: { role: 'alert', hidden: true } });
  const submit = h('button', { class: 'btn btn--block', attrs: { type: 'submit', 'aria-busy': 'false' }, text: submitLabel });
  const form = h('form', { class: `form form--${name}`, attrs: { novalidate: true, 'aria-label': submitLabel.toLowerCase() } }, ...fields, error, submit);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (submit.disabled) return;
    void (async () => {
      error.hidden = true;
      error.textContent = '';
      for (const f of Array.from(form.querySelectorAll('[aria-invalid]'))) f.removeAttribute('aria-invalid');
      submit.disabled = true;
      submit.setAttribute('aria-busy', 'true');
      try {
        await onSubmit();
      } catch (e) {
        session.noteError(e);
        error.textContent = e instanceof FormError ? e.message : messageOf(e);
        error.hidden = false;
        (form.querySelector<HTMLElement>('[aria-invalid="true"]') ?? submit).focus();
      } finally {
        submit.disabled = false;
        submit.setAttribute('aria-busy', 'false');
      }
    })();
  });
  return form;
}
