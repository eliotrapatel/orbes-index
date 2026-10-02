/**
 * Modal dialogs for confirmations and small forms (native <dialog>, so
 * focus trapping, Escape and the backdrop come from the browser).
 *
 * Destructive actions pass a `phrase` the admin must type (e.g.
 * `REVOKE KEY 3`): the confirm button stays disabled until it matches. With
 * `submit`, the request runs while the dialog is open and a refusal from
 * the server is shown inside it, so nothing typed is lost.
 */
import { h, type Child } from '../../shared/dom.js';
import { ApiError } from '../api.js';
import { phraseMatches } from '../model/registry.js';
import { button, field, input, select, textarea } from './components.js';

export interface DialogField {
  name: string;
  label: string;
  /** 'password' fields are masked and take `autocomplete` ('current-password' or 'new-password'). */
  kind?: 'text' | 'textarea' | 'select' | 'date' | 'datetime' | 'password' | 'email';
  autocomplete?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  maxlength?: number;
  value?: string;
}

export type DialogValues = Record<string, string>;

export interface DialogOptions {
  title: string;
  eyebrow?: string;
  body?: Child | Child[];
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Typed confirmation phrase for irreversible actions. */
  phrase?: string;
  fields?: DialogField[];
  /** Client-side check; return a message to block submission. */
  validate?: (values: DialogValues) => string | null;
  /** Performed while the dialog is open; a thrown error is shown in the dialog. */
  submit?: (values: DialogValues) => Promise<void>;
}

function readValues(form: HTMLFormElement): DialogValues {
  const out: DialogValues = {};
  for (const el of Array.from(form.elements)) {
    const c = el as HTMLInputElement;
    if (c.name && c.name !== '__phrase') out[c.name] = c.value;
  }
  return out;
}

function controlFor(f: DialogField): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  switch (f.kind) {
    case 'textarea': {
      const t = textarea(f.name, { maxlength: f.maxlength ?? 1000, rows: 3 });
      if (f.value) t.value = f.value;
      return t;
    }
    case 'select':
      return select(f.name, f.options ?? [], f.value);
    case 'date':
      return input(f.name, { type: 'date', value: f.value });
    case 'datetime':
      return input(f.name, { type: 'datetime-local', value: f.value, step: 60 });
    case 'password':
      return input(f.name, { type: 'password', autocomplete: f.autocomplete ?? 'new-password', maxlength: f.maxlength ?? 1024 });
    case 'email':
      return input(f.name, { type: 'email', value: f.value, autocomplete: f.autocomplete ?? 'off', maxlength: f.maxlength ?? 254 });
    default:
      return input(f.name, { value: f.value, maxlength: f.maxlength ?? 500 });
  }
}

/** Open a dialog; resolves with the field values on confirmation, null on cancel. */
export function openDialog(o: DialogOptions): Promise<DialogValues | null> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const error = h('p', { class: 'dialog__error', attrs: { role: 'alert', 'aria-live': 'assertive' } });
    const confirm = button(o.confirmLabel, { kind: o.danger ? 'danger' : 'primary', type: 'submit', testId: 'dialog-confirm' });
    const cancel = button(o.cancelLabel ?? 'Cancel', { kind: 'ghost', testId: 'dialog-cancel' });

    const controls = (o.fields ?? []).map((f) => {
      const c = controlFor(f);
      if (f.required) c.required = true;
      return field(f.label, c, { hint: f.hint, required: f.required, wide: true });
    });

    let phraseInput: HTMLInputElement | null = null;
    if (o.phrase) {
      phraseInput = input('__phrase', { placeholder: o.phrase, mono: true });
      phraseInput.setAttribute('data-testid', 'dialog-phrase');
      // The phrase can hold an identifier (REVOKE O26-J-00184): it reads in --font, the words around it in the display face.
      const label = h('span', null, 'Type ', h('span', { class: 'cfield__phrase' }, o.phrase), ' to confirm');
      controls.push(field(label, phraseInput, { wide: true, hint: 'This cannot be undone.' }));
      confirm.disabled = true;
      phraseInput.addEventListener('input', () => {
        confirm.disabled = !phraseMatches(phraseInput!.value, o.phrase!);
      });
    }

    const body = o.body === undefined ? [] : Array.isArray(o.body) ? o.body : [o.body];
    const form = h(
      'form',
      { class: 'dialog__form', attrs: { method: 'dialog', novalidate: true } },
      o.eyebrow ? h('p', { class: 'dialog__eyebrow' }, o.eyebrow) : null,
      h('h2', { class: 'dialog__title' }, o.title),
      body.length ? h('div', { class: 'dialog__body' }, ...body) : null,
      controls.length ? h('div', { class: 'dialog__fields' }, ...controls) : null,
      error,
      h('div', { class: 'dialog__actions' }, cancel, confirm),
    );
    const dlg = h('dialog', { class: ['dialog', o.danger ? 'dialog--danger' : null], attrs: { 'aria-label': o.title } }, form);
    document.body.appendChild(dlg);

    let settled = false;
    const finish = (v: DialogValues | null) => {
      if (settled) return;
      settled = true;
      dlg.close();
      dlg.remove();
      previous?.focus?.();
      resolve(v);
    };

    cancel.addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      if (!confirm.hasAttribute('aria-busy')) finish(null);
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      error.textContent = '';
      if (o.phrase && !phraseMatches(phraseInput?.value ?? '', o.phrase)) return;
      for (const el of Array.from(form.querySelectorAll<HTMLInputElement>('input[required], select[required], textarea[required]'))) {
        if (!el.value.trim()) {
          error.textContent = 'Complete the required fields.';
          el.focus();
          return;
        }
      }
      const values = readValues(form);
      const invalid = o.validate?.(values) ?? null;
      if (invalid) {
        error.textContent = invalid;
        return;
      }
      if (!o.submit) return finish(values);
      const label = confirm.textContent;
      confirm.disabled = true;
      cancel.disabled = true;
      confirm.setAttribute('aria-busy', 'true');
      confirm.textContent = 'Working…';
      try {
        await o.submit(values);
        finish(values);
      } catch (e) {
        error.textContent = e instanceof ApiError ? e.message : 'The action could not be completed.';
        confirm.disabled = false;
        cancel.disabled = false;
        confirm.removeAttribute('aria-busy');
        confirm.textContent = label;
      }
    });

    dlg.showModal();
    const first = dlg.querySelector<HTMLElement>('input, select, textarea') ?? confirm;
    first.focus();
  });
}

/** Plain yes/no confirmation. */
export async function confirmAction(title: string, body: string, confirmLabel: string, danger = false): Promise<boolean> {
  return (await openDialog({ title, body: h('p', { class: 'dialog__text' }, body), confirmLabel, danger })) !== null;
}
