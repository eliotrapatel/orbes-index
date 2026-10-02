/**
 * Modal dialogs for confirmations and small forms (native <dialog>, so
 * focus trapping, Escape and the backdrop come from the browser).
 *
 * Destructive actions are marked by the oxblood rule over the dialog and a
 * danger confirm button (`danger`, BRAND §6), and pass a `phrase` the admin
 * must type (e.g. `REVOKE KEY 3`): the confirm button stays disabled until it
 * matches. Both may depend on the fields (a box that adds an irreversible
 * action): they then follow what the fields ask for. With `submit`, the
 * request runs while the dialog is open and a refusal from the server is
 * shown inside it, so nothing typed is lost; while it runs, Confirm stays
 * disabled whatever is typed, and a second submission is ignored.
 */
import { h, type Child } from '../../shared/dom.js';
import { ApiError } from '../api.js';
import { phraseMatches } from '../model/registry.js';
import { button, checkbox, field, input, select, textarea } from './components.js';

export interface DialogField {
  name: string;
  label: string;
  /** `checkbox`: its value is `'true'` when ticked, `''` otherwise (`value: 'true'` ticks it at first). */
  kind?: 'text' | 'textarea' | 'select' | 'date' | 'datetime' | 'checkbox';
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
  /** Destructive: the oxblood rule and a danger confirm; a function decides from the fields. */
  danger?: boolean | ((values: DialogValues) => boolean);
  /** Typed confirmation phrase for irreversible actions; a function decides from the fields (null: none needed). */
  phrase?: string | ((values: DialogValues) => string | null);
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
    if (c.name && c.name !== '__phrase') out[c.name] = c.type === 'checkbox' ? (c.checked ? 'true' : '') : c.value;
  }
  return out;
}

/** A tick box with its hint, laid out as a wide field. */
function checkboxField(f: DialogField): HTMLElement {
  const box = checkbox(f.name, f.label, f.value === 'true');
  return h('div', { class: ['cfield', 'cfield--wide', 'cfield--check'], data: { field: f.name } }, box, f.hint ? h('span', { class: 'cfield__hint' }, f.hint) : null);
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
    default:
      return input(f.name, { value: f.value, maxlength: f.maxlength ?? 500 });
  }
}

/** Open a dialog; resolves with the field values on confirmation, null on cancel. */
export function openDialog(o: DialogOptions): Promise<DialogValues | null> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const error = h('p', { class: 'dialog__error', attrs: { role: 'alert', 'aria-live': 'assertive' } });
    const dangerSpec = o.danger;
    const dangerOf: (values: DialogValues) => boolean = typeof dangerSpec === 'function' ? dangerSpec : () => dangerSpec === true;
    const confirm = button(o.confirmLabel, { kind: 'primary', type: 'submit', testId: 'dialog-confirm' });
    const cancel = button(o.cancelLabel ?? 'Cancel', { kind: 'ghost', testId: 'dialog-cancel' });

    const controls = (o.fields ?? []).map((f) => {
      if (f.kind === 'checkbox') return checkboxField(f);
      const c = controlFor(f);
      if (f.required) c.required = true;
      return field(f.label, c, { hint: f.hint, required: f.required, wide: true });
    });

    // The phrase the fields ask for now (null: none).
    let phraseOf: (values: DialogValues) => string | null = () => null;
    let phraseInput: HTMLInputElement | null = null;
    let syncPhrase = (_values: DialogValues) => {};
    if (o.phrase) {
      const spec = o.phrase;
      phraseOf = typeof spec === 'function' ? spec : () => spec;
      phraseInput = input('__phrase', { mono: true });
      phraseInput.setAttribute('data-testid', 'dialog-phrase');
      // The phrase can hold an identifier (REVOKE O26-J-00184): it reads in --font, the words around it in the display face.
      const phraseText = h('span', { class: 'cfield__phrase' });
      const label = h('span', null, 'Type ', phraseText, ' to confirm');
      const phraseField = field(label, phraseInput, { wide: true, hint: 'This cannot be undone.' });
      controls.push(phraseField);
      syncPhrase = (values) => {
        const p = phraseOf(values);
        phraseField.hidden = p === null;
        phraseText.textContent = p ?? '';
        phraseInput!.placeholder = p ?? '';
        confirm.disabled = p !== null && !phraseMatches(phraseInput!.value, p);
      };
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
    const dlg = h('dialog', { class: 'dialog', attrs: { 'aria-label': o.title } }, form);
    document.body.appendChild(dlg);
    // A submission in flight: Confirm stays disabled, a second one is ignored.
    let busy = false;
    /** What the fields ask for now: the destructive marks, the phrase to type and whether Confirm may be pressed. */
    const sync = () => {
      if (busy) return;
      const values = readValues(form);
      const danger = dangerOf(values);
      dlg.classList.toggle('dialog--danger', danger);
      confirm.classList.toggle('cbtn--danger', danger);
      confirm.classList.toggle('cbtn--primary', !danger);
      syncPhrase(values);
    };
    form.addEventListener('input', sync);
    form.addEventListener('change', sync);
    sync();

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
      if (!busy) finish(null);
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (busy) return;
      error.textContent = '';
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
      const phrase = phraseOf(values);
      if (phrase !== null && !phraseMatches(phraseInput?.value ?? '', phrase)) return;
      if (!o.submit) return finish(values);
      const label = confirm.textContent;
      busy = true;
      confirm.disabled = true;
      cancel.disabled = true;
      confirm.setAttribute('aria-busy', 'true');
      confirm.textContent = 'Working…';
      try {
        await o.submit(values);
        finish(values);
      } catch (e) {
        error.textContent = e instanceof ApiError ? e.message : 'The action could not be completed.';
        busy = false;
        confirm.disabled = false;
        cancel.disabled = false;
        confirm.removeAttribute('aria-busy');
        confirm.textContent = label;
        sync();
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
