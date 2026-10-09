/**
 * A reception's page (plan NEXT LOT of 2026-10-07, §3.5.3): `#/logistics/receptions/new?supplierOrder=:id` to count a
 * delivery against its supplier order, `#/logistics/receptions/:id` to count it again until ORBES confirms it, then to
 * read it. Title 'Reception · SO-7C21A0B9 · <SUPPLIER>': the supplier's name shows here, during the reception only;
 * never a price (the lines come from GET …/receptions/lines/:supplierOrderId, which has no price field).
 *
 *  - The order's lines: model, variant, size, ordered, already received, expected on; Received OK, Rejected and a note
 *    per line. A defective piece goes in Rejected (no identity, back to the supplier); more pieces than ordered need a
 *    note; what is missing stays expected.
 *  - Add a piece not on this order: an offered size of the order's models or of its supplier, with its note.
 *  - The delivery note's number and a note; Record the reception (TO_CONFIRM, for ORBES to confirm).
 *  - ORBES staff (OPERATOR): Confirm the reception (the identities issued) or Send back (with a note).
 * Each request is audited by the server.
 */
import { h, mount } from '../../shared/dom.js';
import { formatCount, formatDate, formatDateTime } from '../format.js';
import {
  confirmReceptionText,
  RECEPTION_STATUS_LABELS,
  RECEPTION_TEXT,
  receptionInputOf,
  receptionProblem,
  skuWords,
  sizeText,
} from '../model/logistics.js';
import { can, logisticsOnly } from '../model/permissions.js';
import { href } from '../router.js';
import type { LogisticsSku, ReceptionOrder, ReceptionView } from '../types.js';
import { button, defList, field, input, linkButton, pageHeader, section, select, statusMark, table, textarea } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

const back = () => linkButton('Back to the list', href('logistics', {}, { tab: 'receptions' }), 'ghost');

/** `#/logistics/receptions/new?supplierOrder=:id`: a delivery counted against its supplier order. */
export async function newReceptionView(ctx: ViewContext): Promise<HTMLElement> {
  const order = await ctx.api.receptionLines(ctx.route.query.supplierOrder ?? '');
  return h(
    'div',
    { class: 'view view--reception', data: { testid: 'reception' } },
    pageHeader({ eyebrow: 'Logistics · Receptions', title: receptionTitle(order.reference, order.supplierName), lead: `${order.location.name} · Expected on ${order.expectedOn ? formatDate(order.expectedOn) : '—'}`, actions: [back()] }),
    countForm(ctx, order, null),
  );
}

/** `#/logistics/receptions/:id`: counted again until ORBES confirms it; read afterwards. */
export async function receptionView(ctx: ViewContext): Promise<HTMLElement> {
  const r = await ctx.api.reception(ctx.route.params.receptionId ?? '');
  const role = ctx.session.admin.role;
  const editable = r.status !== 'CONFIRMED' && can(role, 'logistics');
  const order = editable ? await ctx.api.receptionLines(r.supplierOrder.id) : null;
  const staff = !logisticsOnly(role) && can(role, 'confirmReceptions');
  const tools = staff && r.status === 'TO_CONFIRM' ? [confirmButton(ctx, r), sendBackButton(ctx, r)] : [];
  const facts = defList([
    { label: 'Status', value: h('span', { data: { testid: 'reception-status' } }, statusMark(RECEPTION_STATUS_LABELS[r.status as keyof typeof RECEPTION_STATUS_LABELS] ?? r.status, r.status === 'CONFIRMED' ? 'solid' : 'outline')) },
    { label: 'Counted', value: formatDateTime(r.countedAt) },
    { label: 'Delivery note', value: r.deliveryNote ?? '—' },
    { label: 'Note', value: h('span', { class: 'prewrap' }, r.note ?? '—') },
    ...(r.sentBack ? [{ label: 'Sent back', value: h('span', { class: 'prewrap', data: { testid: 'reception-sent-back' } }, r.sentBack.note), note: formatDateTime(r.sentBack.at) }] : []),
    ...(r.confirmedAt ? [{ label: 'Confirmed', value: formatDateTime(r.confirmedAt) }] : []),
  ]);
  const lines = table(
    [
      { label: 'Model', cell: (l) => l.sku.model.name },
      { label: 'Variant', cell: (l) => l.sku.variant ?? '—', kind: ['nowrap'] },
      { label: 'Size', cell: (l) => h('span', null, sizeText(l.sku.sizeLabel), h('span', { class: 'cell-sub mono' }, l.sku.code), l.onOrder ? null : h('span', { class: 'cell-sub' }, RECEPTION_TEXT.notOnOrder)), kind: ['nowrap'] },
      { label: 'Received OK', cell: (l) => formatCount(l.accepted), kind: ['num'] },
      { label: 'Rejected', cell: (l) => formatCount(l.rejected), kind: ['num'] },
      { label: 'Note', cell: (l) => (l.note ? h('span', { class: 'prewrap' }, l.note) : '—'), kind: ['wide'] },
    ],
    r.lines,
    { caption: 'Lines' },
  );
  return h(
    'div',
    { class: 'view view--reception', data: { testid: 'reception' } },
    pageHeader({ eyebrow: 'Logistics · Receptions', title: receptionTitle(r.supplierOrder.reference, order?.supplierName ?? r.supplierName), lead: r.location.name, actions: [back()] }),
    section('Reception', facts, { id: 'reception-facts', tools }),
    order ? countForm(ctx, order, r) : section('Lines', lines, { id: 'reception-lines' }),
  );
}

/**
 * 'Reception · SO-7C21A0B9 · NORD RINGS' (the supplier's name when it is known to the reader); the reference, an
 * identifier, reads in --font inside the display-face title, as the console's identifiers do.
 */
function receptionTitle(reference: string, supplier: string | null): HTMLElement {
  return h('span', null, 'Reception · ', h('span', { class: 'page-head__id' }, reference), supplier ? ` · ${supplier}` : '');
}

/** Confirm the reception (OPERATOR): the identities issued, the pieces in stock, the rejected listed TO RETURN. */
export function confirmButton(ctx: ViewContext, r: ReceptionView): HTMLButtonElement {
  return button('Confirm', {
    kind: 'primary',
    testId: 'reception-confirm',
    onClick: () =>
      void openDialog({
        title: 'Confirm the reception',
        eyebrow: r.supplierOrder.reference,
        body: h('p', { class: 'dialog__text', data: { testid: 'reception-confirm-text' } }, confirmReceptionText(r)),
        confirmLabel: 'Confirm the reception',
        submit: async () => {
          await ctx.api.confirmReception(r.id);
        },
      }).then((v) => {
        if (!v) return;
        notify(RECEPTION_TEXT.confirmed);
        ctx.reload();
      }),
  });
}

/** Send back (OPERATOR): the agent counts again, with ORBES's note. */
export function sendBackButton(ctx: ViewContext, r: ReceptionView): HTMLButtonElement {
  return button('Send back', {
    kind: 'ghost',
    testId: 'reception-send-back',
    onClick: () =>
      void openDialog({
        title: 'Send back the reception',
        eyebrow: r.supplierOrder.reference,
        body: h('p', { class: 'dialog__text' }, RECEPTION_TEXT.sendBackText),
        fields: [{ name: 'note', label: 'Note', kind: 'textarea', required: true, maxlength: 1000 }],
        confirmLabel: 'Send back',
        submit: async (v) => {
          await ctx.api.sendBackReception(r.id, v.note.trim());
        },
      }).then((v) => {
        if (!v) return;
        notify(RECEPTION_TEXT.sentBack);
        ctx.reload();
      }),
  });
}

/** The count: one row per line of the order, then the pieces not on it; Record the reception. */
function countForm(ctx: ViewContext, order: ReceptionOrder, current: ReceptionView | null): HTMLElement {
  const counted = new Map((current?.lines ?? []).map((l) => [l.sku.id, l]));
  const onOrder = new Set(order.lines.map((l) => l.sku.id));
  // The pieces not on this order: those already counted, and those added here.
  const extras: LogisticsSku[] = (current?.lines ?? []).filter((l) => !onOrder.has(l.sku.id)).map((l) => l.sku);
  const error = h('p', { class: 'form-error', attrs: { role: 'alert', 'aria-live': 'assertive' }, data: { testid: 'reception-error' } });
  // Each cell named for a screen reader by its column and its line: 'Received OK · MONOLITHE · BLUE · 52'.
  const count = (name: string, label: string, value: number | undefined) => {
    const el = input(name, { value: value === undefined ? '' : String(value), maxlength: 5, inputmode: 'numeric' });
    el.classList.add('cinput--count');
    el.setAttribute('aria-label', label);
    return el;
  };
  const note = (name: string, label: string, value: string | null | undefined) => {
    const el = input(name, { value: value ?? '', maxlength: 500 });
    el.setAttribute('aria-label', label);
    return el;
  };
  const rows = h('tbody');
  const drawRows = () =>
    mount(
      rows,
      ...order.lines.map((l) =>
        h(
          'tr',
          { data: { testid: 'reception-line' } },
          h('td', null, l.sku.model.name),
          h('td', null, l.sku.variant ?? '—'),
          h('td', { class: 'col--nowrap' }, sizeText(l.sku.sizeLabel), h('span', { class: 'cell-sub mono' }, l.sku.code)),
          h('td', { class: 'col--num' }, formatCount(l.ordered)),
          h('td', { class: 'col--num' }, formatCount(l.alreadyReceived)),
          h('td', { class: 'col--nowrap' }, order.expectedOn ? formatDate(order.expectedOn) : '—'),
          h('td', null, count(`accepted_${l.sku.id}`, `Received OK · ${skuWords(l.sku)}`, counted.get(l.sku.id)?.accepted)),
          h('td', null, count(`rejected_${l.sku.id}`, `Rejected · ${skuWords(l.sku)}`, counted.get(l.sku.id)?.rejected)),
          h('td', null, note(`note_${l.sku.id}`, `Note · ${skuWords(l.sku)}`, counted.get(l.sku.id)?.note)),
        ),
      ),
      ...extras.map((k) =>
        h(
          'tr',
          { data: { testid: 'reception-extra' } },
          h('td', null, k.model.name),
          h('td', null, k.variant ?? '—'),
          h('td', { class: 'col--nowrap' }, sizeText(k.sizeLabel), h('span', { class: 'cell-sub mono' }, k.code), h('span', { class: 'cell-sub' }, RECEPTION_TEXT.notOnOrder)),
          h('td', { class: 'col--num' }, '—'),
          h('td', { class: 'col--num' }, '—'),
          h('td', null, '—'),
          h('td', null, count(`accepted_${k.id}`, `Received OK · ${skuWords(k)}`, counted.get(k.id)?.accepted)),
          h('td', null, count(`rejected_${k.id}`, `Rejected · ${skuWords(k)}`, counted.get(k.id)?.rejected)),
          h('td', null, note(`note_${k.id}`, `Note · ${skuWords(k)}`, counted.get(k.id)?.note)),
        ),
      ),
    );
  drawRows();
  const head = ['Model', 'Variant', 'Size', 'Ordered', 'Already received', 'Expected on', 'Received OK', 'Rejected', 'Note'];
  const grid = h(
    'div',
    { class: 'table-wrap' },
    h('table', { class: 'table reception__lines' }, h('caption', { class: 'visually-hidden' }, 'The order’s lines'), h('thead', null, h('tr', null, ...head.map((x) => h('th', { attrs: { scope: 'col' } }, x)))), rows),
  );

  const others = () => order.offered.filter((k) => !onOrder.has(k.id) && !extras.some((x) => x.id === k.id));
  const extraSelect = select('extra', [{ value: '', label: 'Choose a size' }, ...others().map((k) => ({ value: k.id, label: `${skuWords(k)} · ${k.code}` }))], '');
  extraSelect.setAttribute('data-testid', 'reception-extra-select');
  const addExtra = button(RECEPTION_TEXT.addExtra, {
    kind: 'ghost',
    testId: 'reception-extra-add',
    onClick: () => {
      const k = order.offered.find((x) => x.id === extraSelect.value);
      if (!k) return;
      // What was typed stays: read it before drawing the rows again.
      const kept = valuesOf(form);
      extras.push(k);
      drawRows();
      for (const [name, value] of Object.entries(kept)) {
        const el = form.querySelector<HTMLInputElement>(`[name="${name}"]`);
        if (el) el.value = value;
      }
      extraSelect.querySelector(`option[value="${k.id}"]`)?.remove();
      extraSelect.value = '';
    },
  });

  const deliveryNote = input('deliveryNote', { value: current?.deliveryNote ?? '', maxlength: 60 });
  const generalNote = textarea('note', { maxlength: 1000, rows: 3 });
  generalNote.value = current?.note ?? '';
  const submit = button(RECEPTION_TEXT.record, { kind: 'primary', type: 'submit', testId: 'reception-record' });
  const form = h(
    'form',
    { class: 'reception__form', attrs: { novalidate: true } },
    h('p', { class: 'panel__text' }, RECEPTION_TEXT.countText),
    grid,
    order.offered.length > 0 ? h('div', { class: 'reception__extra' }, field('Size', extraSelect), addExtra) : null,
    h('div', { class: 'reception__fields' }, field('Delivery note', deliveryNote, { hint: 'The supplier’s number, optional.' }), field('Note', generalNote, { hint: 'Optional.' })),
    error,
    h('div', { class: 'row-actions' }, submit),
  );
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    error.textContent = '';
    const values = valuesOf(form);
    const problem = receptionProblem(order, extras, values);
    if (problem) {
      error.textContent = problem;
      return;
    }
    submit.disabled = true;
    try {
      const body = receptionInputOf(order, extras, values);
      if (current) await ctx.api.updateReception(current.id, body);
      else await ctx.api.recordReception({ supplierOrderId: order.id, ...body });
      notify(RECEPTION_TEXT.recorded);
      ctx.navigate(href('logistics', {}, { tab: 'receptions' }));
    } catch (e) {
      submit.disabled = false;
      error.textContent = e instanceof Error ? e.message : 'The reception could not be recorded.';
      notifyError(e);
    }
  });
  return section(current ? 'Count again' : 'The count', form, { id: 'reception-count' });
}

function valuesOf(form: HTMLFormElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const el of Array.from(form.elements) as HTMLInputElement[]) if (el.name) out[el.name] = el.value;
  return out;
}
