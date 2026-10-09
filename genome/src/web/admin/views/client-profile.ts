/**
 * The client sheet's Profile section (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.4.2, §3.0 (h), step 5.5): what the
 * client gave in YOUR PROFILE and what Client Services changed, as the role reads it (an AUDITOR: the date of birth as an
 * age band; the phone, the city, the address and the Instagram withheld), and, for an OPERATOR or an ADMIN while the
 * account is not DELETED, its three dialogs:
 *   - Edit the profile: every field but the date of birth, opened on the profile as it is now and the choices offered
 *     now (GET /api/admin/owners/:id/profile), sent whole with the version read; a refusal of the server is said under
 *     its field; after 409 PROFILE_CHANGED (the client saved meanwhile) the dialog is filled again and stays open;
 *   - Change the date of birth: a date (empty removes it) and why, kept as a private note on the sheet;
 *   - Edit the address (Add an address while none is saved): the default address of YOUR ADDRESSES, H2's four fields.
 * Each change is audited by the server by its fields' names, never their values. The words are model/client-profile.ts.
 */
import { h, mount } from '../../shared/dom.js';
import { ApiError } from '../api.js';
import {
  addressFormOf,
  addressProblem,
  BIRTH_DATE_WHY_MAX,
  birthDateInput,
  birthDateProblem,
  birthDateValueOf,
  countrySelectOptions,
  heardSelectOptions,
  instagramHref,
  isOtherAnswer,
  phoneCodeOptions,
  PROFILE_COPY as P,
  profileErrorField,
  profileFormOf,
  profileFormProblem,
  profileInput,
  profileRows,
  profileTools,
  profileUnchanged,
  tasteChoices,
  type ProfileForm,
  type ProfileRow,
} from '../model/client-profile.js';
import { countryOptions } from '../model/orders.js';
import { can } from '../model/permissions.js';
import type { ClientProfile, ClientProfileEdit, ClientTaste, OwnerSheet } from '../types.js';
import { button, checkbox, defList, field, input, section, select, setFieldError, type DefRow } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

/** A finish's dot, its colour set through the CSSOM (no inline style attribute). */
function dot(swatch: string | undefined): HTMLElement | null {
  if (!swatch) return null;
  const d = h('span', { class: 'variant-dot', attrs: { 'aria-hidden': 'true' } });
  d.style.backgroundColor = swatch;
  return d;
}

function finishesValue(list: readonly ClientTaste[]): HTMLElement {
  return h(
    'span',
    { class: 'client-profile__finishes' },
    ...list.map((t) => h('span', { class: 'variant-label' }, dot(t.swatch), t.retired ? `${t.label} ${P.retired}` : t.label)),
  );
}

function rowValue(r: ProfileRow, p: ClientProfile): HTMLElement | string {
  if (r.kind === 'instagram' && p.instagram) {
    return h('a', { class: 'idlink', attrs: { href: instagramHref(p.instagram), target: '_blank', rel: 'noopener noreferrer', 'data-testid': 'profile-instagram' } }, `@${p.instagram}`);
  }
  if (r.kind === 'finishes') return finishesValue(p.tastes.finishes);
  if (Array.isArray(r.value)) return h('span', { class: 'client-profile__lines' }, ...r.value.map((l) => h('span', { class: 'client-profile__line' }, l)));
  return r.value;
}

/** The Profile section, right after Account (C.4.1). */
export function profileSection(ctx: ViewContext, sheet: OwnerSheet): HTMLElement {
  const p = sheet.profile;
  const o = sheet.owner;
  const tools = profileTools(p, { canEdit: can(ctx.session.admin.role, 'editClientProfile'), status: o.status });
  const done = (r: unknown) => {
    if (r) ctx.reload();
  };
  const buttons: HTMLElement[] = [];
  if (tools.edit) buttons.push(button(P.edit, { kind: 'ghost', testId: 'profile-edit', onClick: () => void editProfile(ctx, o.id, o.email).then(done, notifyError) }));
  if (tools.birthDate) buttons.push(button(P.changeBirthDate, { kind: 'ghost', testId: 'profile-birth-date', onClick: () => void changeBirthDate(ctx, o.id, o.email, p).then(done, notifyError) }));
  if (tools.address) {
    buttons.push(
      button(tools.address === 'add' ? P.addAddress : P.editAddress, { kind: 'ghost', testId: 'profile-address', onClick: () => void editAddress(ctx, o.id, o.email, p).then(done, notifyError) }),
    );
  }
  const rows: DefRow[] = profileRows(p).map((r) => ({ label: r.label, value: h('span', { data: { testid: 'profile-value' } }, rowValue(r, p)), note: r.note }));
  return section(P.title, h('div', { data: { testid: 'client-profile' } }, defList(rows)), { id: 'profile', note: P.note, tools: buttons });
}

// ── Edit the profile ─────────────────────────────────────────────────────────────────────────────────────────────

/** A group of tick boxes under one label, laid out as a wide field (its hint carries a refusal). */
function tasteField(name: 'pieces' | 'finishes', label: string, edit: ClientProfileEdit, ticked: readonly string[]): HTMLElement {
  const choices = tasteChoices(name, edit);
  const on = new Set(ticked);
  return h(
    'fieldset',
    { class: ['cfield', 'cfield--wide', 'cfield--checks'], data: { field: name, testid: `profile-${name}` } },
    h('legend', { class: 'cfield__label' }, label),
    choices.length === 0
      ? h('span', { class: 'soft' }, P.noChoice)
      : h(
          'div',
          { class: 'client-profile__choices' },
          ...choices.map((c) => {
            const box = checkbox(name, c.label, on.has(c.key));
            const el = box.querySelector('input')!;
            el.value = c.key;
            const d = dot(c.swatch);
            if (d) box.querySelector('.ccheck__label')!.prepend(d, ' ');
            return box;
          }),
        ),
    h('span', { class: 'cfield__hint' }, ''),
  );
}

/** Edit the profile (C.4.2): resolves true once saved, false when cancelled. */
async function editProfile(ctx: ViewContext, accountId: string, email: string): Promise<boolean> {
  let edit = await ctx.api.clientProfile(accountId);
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const error = h('p', { class: 'dialog__error', attrs: { role: 'alert', 'aria-live': 'assertive' } });
    const fields = h('div', { class: 'dialog__fields' });
    const confirm = button(P.save, { kind: 'primary', type: 'submit', testId: 'dialog-confirm' });
    const cancel = button('Cancel', { kind: 'ghost', testId: 'dialog-cancel' });
    const form = h(
      'form',
      { class: 'dialog__form', attrs: { method: 'dialog', novalidate: true } },
      h('p', { class: 'dialog__eyebrow' }, email),
      h('h2', { class: 'dialog__title' }, P.editTitle),
      fields,
      error,
      h('div', { class: 'dialog__actions' }, cancel, confirm),
    );
    const dlg = h('dialog', { class: ['dialog', 'client-profile__dialog'], attrs: { 'aria-label': P.editTitle, 'data-testid': 'profile-dialog' } }, form);

    let heardSelect: HTMLSelectElement;
    let otherField: HTMLElement;
    /** Draw the fields from the profile as it is now (on opening, and again after 409 PROFILE_CHANGED). */
    const draw = () => {
      const f = profileFormOf(edit.profile);
      const p = edit.profile;
      const text = (name: keyof ProfileForm, maxlength: number, value: string, o: { autocomplete?: string } = {}) => input(name, { maxlength, value, autocomplete: o.autocomplete });
      heardSelect = select('heard', heardSelectOptions(edit), f.heard);
      const otherInput = text('heardOther', 100, f.heardOther);
      otherField = field(P.heardOther, otherInput, { wide: true });
      const showOther = () => {
        otherField.hidden = !isOtherAnswer(edit, heardSelect.value);
      };
      heardSelect.addEventListener('change', showOther);
      mount(
        fields,
        field(P.firstName, text('firstName', 50, f.firstName, { autocomplete: 'off' }), { wide: true, required: p.firstName !== null }),
        field(P.lastName, text('lastName', 50, f.lastName, { autocomplete: 'off' }), { wide: true, required: p.lastName !== null }),
        field(P.country, select('country', countrySelectOptions(p.country), f.country), { wide: true, required: p.country !== null }),
        field(P.city, text('city', 80, f.city, { autocomplete: 'off' }), { wide: true }),
        field(P.phoneCountry, select('phoneCountry', phoneCodeOptions(), f.phoneCountry), { wide: true }),
        field(P.phoneNumber, text('phoneNumber', 20, f.phoneNumber, { autocomplete: 'off' }), { wide: true, hint: P.phoneHint }),
        field(P.instagram, text('instagram', 60, f.instagram, { autocomplete: 'off' }), { wide: true, hint: P.instagramHint }),
        field(P.heard, heardSelect, { wide: true }),
        otherField,
        tasteField('pieces', P.pieces, edit, f.pieces),
        tasteField('finishes', P.finishes, edit, f.finishes),
      );
      showOther();
    };
    draw();

    const read = (): ProfileForm => {
      const v = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
      const ticked = (name: string) => [...form.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`)].filter((b) => b.checked).map((b) => b.value);
      return {
        firstName: v('firstName'),
        lastName: v('lastName'),
        country: v('country'),
        city: v('city'),
        phoneCountry: v('phoneCountry'),
        phoneNumber: v('phoneNumber'),
        instagram: v('instagram'),
        heard: v('heard'),
        heardOther: v('heardOther'),
        pieces: ticked('pieces'),
        finishes: ticked('finishes'),
      };
    };
    const NAMES: (keyof ProfileForm)[] = ['firstName', 'lastName', 'country', 'city', 'phoneCountry', 'phoneNumber', 'instagram', 'heard', 'heardOther', 'pieces', 'finishes'];
    const clearErrors = () => {
      error.textContent = '';
      for (const n of NAMES) setFieldError(form, n, undefined);
    };

    let busy = false;
    let settled = false;
    const finish = (saved: boolean) => {
      if (settled) return;
      settled = true;
      dlg.close();
      dlg.remove();
      previous?.focus?.();
      resolve(saved);
    };
    cancel.addEventListener('click', () => {
      if (!busy) finish(false);
    });
    dlg.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      if (!busy) finish(false);
    });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (busy) return;
      clearErrors();
      const f = read();
      const other = isOtherAnswer(edit, f.heard);
      const problem = profileFormProblem(f, edit.profile, other);
      if (problem) {
        setFieldError(form, problem.field, problem.message);
        (form.elements.namedItem(problem.field) as HTMLElement | null)?.focus?.();
        return;
      }
      if (profileUnchanged(f, edit)) {
        error.textContent = P.unchanged;
        return;
      }
      busy = true;
      confirm.disabled = true;
      cancel.disabled = true;
      confirm.setAttribute('aria-busy', 'true');
      confirm.textContent = P.saving;
      try {
        await ctx.api.saveClientProfile(accountId, profileInput(f, edit.profile.version, other));
        notify(P.saved);
        busy = false;
        finish(true);
        return;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'PROFILE_CHANGED') {
          // The client saved meanwhile: read it again, fill the dialog with it, and say so.
          try {
            edit = await ctx.api.clientProfile(accountId);
            draw();
          } catch {
            /* the words below still stand */
          }
          error.textContent = e.message;
        } else {
          const where = e instanceof ApiError ? profileErrorField(e.code, e.message) : null;
          const message = e instanceof ApiError ? e.message : P.failed;
          if (where && form.querySelector(`.cfield[data-field="${where}"]`)) setFieldError(form, where, message);
          else error.textContent = message;
        }
      }
      busy = false;
      confirm.disabled = false;
      cancel.disabled = false;
      confirm.removeAttribute('aria-busy');
      confirm.textContent = P.save;
    });

    document.body.appendChild(dlg);
    dlg.showModal();
    (form.elements.namedItem('firstName') as HTMLInputElement | null)?.focus();
  });
}

// ── Change the date of birth ─────────────────────────────────────────────────────────────────────────────────────

async function changeBirthDate(ctx: ViewContext, accountId: string, email: string, profile: ClientProfile): Promise<boolean> {
  let p = profile;
  let removed = false;
  const r = await openDialog({
    title: P.birthTitle,
    eyebrow: email,
    body: h('p', { class: 'dialog__text' }, P.birthBody),
    fields: [
      { name: 'birthDate', label: P.birthField, kind: 'date', value: birthDateValueOf(p), hint: P.birthHint },
      { name: 'why', label: P.why, kind: 'textarea', required: true, maxlength: BIRTH_DATE_WHY_MAX, rows: 3, hint: P.whyHint },
    ],
    validate: (v) => birthDateProblem({ birthDate: v.birthDate, why: v.why }, p),
    confirmLabel: P.change,
    working: P.saving,
    submit: async (v) => {
      try {
        removed = v.birthDate === '';
        await ctx.api.setClientBirthDate(accountId, birthDateInput({ birthDate: v.birthDate, why: v.why }, p.version));
      } catch (e) {
        // The client saved meanwhile: the next Change sends the version read again.
        if (e instanceof ApiError && e.code === 'PROFILE_CHANGED') p = (await ctx.api.clientProfile(accountId).catch(() => ({ profile: p }))).profile;
        throw e;
      }
    },
  });
  if (r) notify(removed ? P.birthRemoved : P.birthSaved);
  return r !== null;
}

// ── Edit the address ─────────────────────────────────────────────────────────────────────────────────────────────

async function editAddress(ctx: ViewContext, accountId: string, email: string, p: ClientProfile): Promise<boolean> {
  const start = addressFormOf(p);
  const r = await openDialog({
    title: p.address ? P.addressTitle : P.addressNew,
    eyebrow: email,
    body: h('p', { class: 'dialog__text' }, P.addressBody),
    fields: [
      { name: 'name', label: P.addressName, required: true, maxlength: 200, value: start.name },
      { name: 'address', label: P.addressLines, kind: 'textarea', required: true, rows: 3, maxlength: 1000, value: start.address, hint: P.addressHint },
      { name: 'country', label: P.addressCountry, kind: 'select', required: true, options: countryOptions(), value: start.country },
      { name: 'phone', label: P.addressPhone, required: true, maxlength: 40, value: start.phone, hint: P.addressPhoneHint },
    ],
    validate: (v) => addressProblem({ name: v.name, address: v.address, country: v.country, phone: v.phone }, p),
    confirmLabel: P.save,
    working: P.saving,
    submit: async (v) => {
      await ctx.api.saveClientAddress(accountId, { name: v.name.trim(), address: v.address.trim(), country: v.country, phone: v.phone.trim() });
    },
  });
  if (r) notify(P.addressSaved);
  return r !== null;
}
