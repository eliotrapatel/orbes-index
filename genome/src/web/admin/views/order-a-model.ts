/**
 * ORDER A MODEL (macro scope of 2026-10-20, K11 Z1 and Z2; plan MACRO M3 §3.3, step M3.7): the Supplier orders page's
 * panel, an OPERATOR's, opened by its header tool. A dialog wide enough for the table, built on the console's dialog
 * (ui/dialog.ts's look, its own steps):
 *
 *  1. MODEL (each main model, then its variants under it, naturally sorted), PIECES (1 to 10 000), LOCATIONS (every one
 *     at first), PROPOSE: POST /api/admin/supplier-orders/split.
 *  2. The split: SIZE · LOCATION · ORDERS (net of size exchanges) · SAVED SIZES · PROPOSED · TO ORDER, each TO ORDER
 *     editable (0 leaves its line out); the total « N of M pieces » kept in view, with a warning (never a refusal) when
 *     it differs from the pieces asked; where the proposal comes from; the saved sizes matching no size. A model with no
 *     offered size: the Catalogue's sentence, and the way to its page. The model, the pieces or the locations changed
 *     after PROPOSE: ADD TO DRAFTS waits for PROPOSE again.
 *  3. ADD TO DRAFTS: POST …/split/drafts, every line above 0 in its supplier's draft for its location, all or nothing
 *     (a refusal, SKU_NO_SUPPLIER or SIZE_SET_ASIDE, is said in the panel and nothing is added); the drafts written are
 *     named in the toast and listed in the panel, each linked to its page; the page underneath is read again.
 *
 * Nothing is applied without staff, and closing the panel discards the split: while a TO ORDER differs from the
 * proposal, the console's leave-guard holds the page, and Close (or Escape) asks first. Following a link, or leaving the
 * page, closes the panel. Counts only: the proposal never names a collector.
 */
import { h, mount } from '../../shared/dom.js';
import { ApiError } from '../api.js';
import { formatCount } from '../format.js';
import { sizeText } from '../model/logistics.js';
import {
  piecesOf,
  piecesProblem,
  SPLIT_COLUMNS,
  SPLIT_TEXT,
  splitAddedToast,
  splitDraftLines,
  splitDraftWords,
  splitEdited,
  splitLineKey,
  splitModelChoices,
  splitSourceLine,
  splitTotal,
  splitTotalLine,
  splitTotalWarning,
  splitUnmatchedLine,
  toOrderOf,
} from '../model/size-split.js';
import { href } from '../router.js';
import type { Model, SizeSplitProposal, StockLocation } from '../types.js';
import { button, checkbox, emptyState, field, input, linkButton, select } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { heldMessage, holdPage } from '../ui/leave-guard.js';
import { notify } from '../ui/toast.js';
import type { ViewContext } from './context.js';

/** What PROPOSE asked: the split on screen answers it, until one of the three changes. */
interface Asked {
  modelId: string;
  quantity: number;
  locationIds: string[];
}

const sameAsked = (a: Asked | null, b: Asked | null) =>
  !!a && !!b && a.modelId === b.modelId && a.quantity === b.quantity && a.locationIds.length === b.locationIds.length && a.locationIds.every((x, i) => x === b.locationIds[i]);

/** Open ORDER A MODEL over the page; `models` and `locations` as the console reads them. */
export function openOrderAModel(ctx: ViewContext, models: readonly Model[], locations: readonly StockLocation[]): void {
  const T = SPLIT_TEXT;
  const previous = document.activeElement as HTMLElement | null;

  // ── The ask ──
  const model = select('modelId', splitModelChoices(models), '');
  model.setAttribute('data-testid', 'split-model');
  const pieces = input('quantity', { inputmode: 'numeric', maxlength: 6, placeholder: '120' });
  pieces.setAttribute('data-testid', 'split-pieces');
  const boxes = locations.map((l) => {
    const c = checkbox('locationId', l.name, true);
    const box = c.querySelector('input')!;
    box.value = l.id;
    box.setAttribute('data-testid', 'split-location');
    return c;
  });
  const propose = button(T.propose, { kind: 'secondary', type: 'submit', testId: 'split-propose' });
  const askError = h('p', { class: 'split__ask-error', attrs: { role: 'alert' }, data: { testid: 'split-ask-error' } });
  const ask = h(
    'form',
    { class: 'split__ask', attrs: { novalidate: true } },
    h(
      'div',
      { class: 'split__row' },
      field(T.model, model, { wide: true }),
      field(T.pieces, pieces, { hint: T.piecesHint }),
    ),
    h(
      'fieldset',
      { class: ['cfield', 'cfield--wide', 'split__locations'] },
      h('legend', { class: 'cfield__label' }, T.locations),
      h('div', { class: 'split__checks' }, ...boxes),
      h('span', { class: 'cfield__hint' }, T.locationsHint),
    ),
    h('div', { class: 'split__go' }, propose, askError),
  );

  // ── The split ──
  const result = h('div', { class: 'split__result', attrs: { 'aria-live': 'polite' }, data: { testid: 'split-result' } });
  const error = h('p', { class: ['dialog__error', 'split__error'], attrs: { role: 'alert', 'aria-live': 'assertive' }, data: { testid: 'split-error' } });
  const close = button(T.close, { kind: 'ghost', testId: 'split-close' });
  const add = button(T.add, { kind: 'primary', testId: 'split-add', disabled: true });
  // The total, its warning and what blocks ADD TO DRAFTS stay in view with the buttons, under however many lines.
  const figures = h('div', { class: 'split__figures' });
  const actions = h('div', { class: ['dialog__actions', 'split__actions'] }, error, figures, close, add);

  const dlg = h(
    'dialog',
    { class: ['dialog', 'dialog--split'], attrs: { 'aria-label': T.title }, data: { testid: 'split-dialog' } },
    h(
      'div',
      { class: 'dialog__form' },
      h('p', { class: 'dialog__eyebrow' }, T.eyebrow),
      h('h2', { class: 'dialog__title' }, T.title),
      h('div', { class: 'dialog__body' }, h('p', { class: 'dialog__text' }, T.lead)),
      ask,
      result,
      actions,
    ),
  );

  let proposal: SizeSplitProposal | null = null;
  let asked: Asked | null = null;
  const edits = new Map<string, string>();
  let added = false;
  let working = false;
  let release: (() => void) | null = null;

  /** What the ask holds now (null: not a request yet), with what is wrong with it. */
  const askNow = (): { asked: Asked | null; problem: string | null } => {
    const locationIds = boxes.map((c) => c.querySelector('input')!).filter((b) => b.checked).map((b) => b.value);
    if (!model.value) return { asked: null, problem: T.chooseModel };
    const quantity = piecesOf(pieces.value);
    if (quantity === null) return { asked: null, problem: piecesProblem(pieces.value) };
    if (locationIds.length === 0) return { asked: null, problem: T.chooseLocation };
    return { asked: { modelId: model.value, quantity, locationIds }, problem: null };
  };

  /** Hold the page while a TO ORDER differs from the proposal; release it otherwise. */
  const hold = () => {
    const edited = !added && proposal !== null && splitEdited(proposal, edits);
    if (edited && !release) release = holdPage(T.unsaved, T.title);
    if (!edited && release) {
      release();
      release = null;
    }
    return edited;
  };

  // The figures under the table and ADD TO DRAFTS follow every TO ORDER typed and every change of the ask.
  const totalLine = h('p', { class: 'split__total', data: { testid: 'split-total' } });
  const warning = h('p', { class: 'split__warning', attrs: { role: 'status' }, data: { testid: 'split-warning' } });
  const staleLine = h('p', { class: 'split__stale', attrs: { role: 'status' }, data: { testid: 'split-stale' } });
  const sync = () => {
    hold();
    if (!proposal || added) {
      add.disabled = true;
      return;
    }
    const total = splitTotal(proposal, edits);
    const stale = !sameAsked(askNow().asked, asked);
    totalLine.textContent = total === null ? T.lineProblem : splitTotalLine(total, proposal.quantity);
    totalLine.classList.toggle('is-invalid', total === null);
    warning.textContent = total === null ? '' : total === 0 ? T.nothingToAdd : (splitTotalWarning(total, proposal.quantity) ?? '');
    staleLine.textContent = stale ? T.stale : '';
    add.disabled = working || stale || total === null || total === 0;
  };

  const drawSplit = (p: SizeSplitProposal) => {
    const rows = p.lines.map((l) => {
      const key = splitLineKey(l);
      const qty = input(`toOrder-${key}`, { inputmode: 'numeric', maxlength: 6, value: String(l.proposed) });
      qty.classList.add('cinput--count', 'split__qty');
      qty.setAttribute('data-testid', 'split-to-order');
      qty.setAttribute('aria-label', `To order: ${sizeText(l.sku.sizeLabel)} at ${l.location.name}`);
      const tr = h(
        'tr',
        { class: [l.proposed === 0 ? 'is-zero' : null], data: { testid: 'split-row' } },
        h(
          'td',
          { class: 'col--nowrap' },
          h('span', null, sizeText(l.sku.sizeLabel), h('span', { class: 'cell-sub mono split__code' }, l.sku.code)),
          // A phone reads the location and the figures under the size, its other columns hidden.
          h('span', { class: 'cell-sub split__phone', attrs: { 'aria-hidden': 'true' } }, l.location.name),
          h('span', { class: 'cell-sub split__phone', attrs: { 'aria-hidden': 'true' } }, `Orders ${formatCount(l.orders)} · Saved sizes ${formatCount(l.savedSizes)} · Proposed ${formatCount(l.proposed)}`),
        ),
        h('td', { class: 'col--nowrap' }, l.location.name),
        h('td', { class: 'col--num' }, formatCount(l.orders)),
        h('td', { class: 'col--num' }, formatCount(l.savedSizes)),
        h('td', { class: 'col--num', data: { testid: 'split-proposed' } }, formatCount(l.proposed)),
        h('td', { class: 'col--num' }, qty),
      );
      qty.addEventListener('input', () => {
        edits.set(key, qty.value);
        const n = toOrderOf(qty.value);
        qty.classList.toggle('is-invalid', n === null);
        if (n === null) qty.setAttribute('aria-invalid', 'true');
        else qty.removeAttribute('aria-invalid');
        tr.classList.toggle('is-zero', n === 0);
        sync();
      });
      return tr;
    });
    mount(figures, totalLine, warning, staleLine);
    const unmatched = splitUnmatchedLine(p.unmatched);
    mount(
      result,
      h(
        'div',
        { class: 'table-wrap split__table' },
        h(
          'table',
          { class: 'table' },
          h('caption', { class: 'visually-hidden' }, T.caption),
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              ...SPLIT_COLUMNS.map((c, i) => h('th', { class: i < 2 ? 'col--nowrap' : 'col--num', attrs: { scope: 'col' } }, c)),
            ),
          ),
          h('tbody', null, ...rows),
        ),
      ),
      h(
        'div',
        { class: 'split__notes' },
        h('p', { class: 'split__note', data: { testid: 'split-source' } }, splitSourceLine(p)),
        unmatched ? h('p', { class: 'split__note', data: { testid: 'split-unmatched' } }, unmatched) : null,
        h('p', { class: 'split__note' }, T.zeroNote),
      ),
    );
  };

  const drawNoSizes = (modelId: string) => {
    mount(figures);
    mount(
      result,
      h('div', { class: 'split__empty', data: { testid: 'split-no-sizes' } }, emptyState(T.noSizes), linkButton(T.openModel, href('model', { modelId }), 'ghost')),
    );
  };

  const drawAdded = (r: Awaited<ReturnType<typeof ctx.api.supplierSplitDrafts>>) => {
    mount(figures);
    mount(
      result,
      h(
        'div',
        { class: 'split__added', data: { testid: 'split-added' } },
        h('h3', { class: 'split__added-title' }, T.addedTitle),
        h(
          'ul',
          { class: 'split__drafts' },
          ...r.drafts.map((d) =>
            h(
              'li',
              { class: 'split__draft' },
              h('a', { class: 'idlink mono', attrs: { href: href('supplierOrder', { supplierOrderId: d.id }) }, data: { testid: 'split-draft' } }, d.reference),
              h('span', { class: 'split__draft-words' }, splitDraftWords(d)),
            ),
          ),
        ),
        h('p', { class: 'split__note' }, T.addedNote),
      ),
    );
  };

  // ── PROPOSE ──
  ask.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (working || added) return;
    const now = askNow();
    askError.textContent = now.problem ?? '';
    if (!now.asked) return;
    if (proposal && hold() && !(await discardFirst())) return;
    const label = propose.textContent;
    working = true;
    propose.disabled = true;
    propose.setAttribute('aria-busy', 'true');
    propose.textContent = T.proposing;
    error.textContent = '';
    sync();
    try {
      const all = now.asked.locationIds.length === locations.length;
      const p = await ctx.api.supplierSplit({ modelId: now.asked.modelId, quantity: now.asked.quantity, ...(all ? {} : { locationIds: now.asked.locationIds }) });
      proposal = p;
      asked = now.asked;
      edits.clear();
      drawSplit(p);
    } catch (e) {
      proposal = null;
      asked = null;
      edits.clear();
      if (e instanceof ApiError && e.code === 'MODEL_NO_SIZES') drawNoSizes(now.asked.modelId);
      else {
        mount(figures);
        mount(result);
        error.textContent = e instanceof ApiError ? e.message : T.failed;
      }
    } finally {
      working = false;
      propose.disabled = false;
      propose.removeAttribute('aria-busy');
      propose.textContent = label;
      sync();
    }
  });
  // Changing the ask after PROPOSE: the split stays on screen, ADD TO DRAFTS waits for PROPOSE again.
  ask.addEventListener('input', (ev) => {
    if (ev.target === pieces || ev.target === model || boxes.some((b) => b.contains(ev.target as Node))) {
      askError.textContent = '';
      sync();
    }
  });
  ask.addEventListener('change', () => sync());

  // ── ADD TO DRAFTS ──
  add.addEventListener('click', async () => {
    if (!proposal || working || added) return;
    const lines = splitDraftLines(proposal, edits);
    if (!lines || lines.length === 0) return;
    const label = add.textContent;
    working = true;
    add.disabled = true;
    close.disabled = true;
    add.setAttribute('aria-busy', 'true');
    add.textContent = T.adding;
    error.textContent = '';
    try {
      const r = await ctx.api.supplierSplitDrafts(lines);
      added = true;
      hold();
      drawAdded(r);
      for (const el of [model, pieces, propose, ...boxes.map((b) => b.querySelector('input')!)]) el.disabled = true;
      add.hidden = true;
      close.textContent = T.done;
      close.classList.replace('cbtn--ghost', 'cbtn--primary');
      notify(splitAddedToast(r));
      ctx.reload();
    } catch (e) {
      error.textContent = e instanceof ApiError ? e.message : 'The action could not be completed.';
      add.textContent = label;
    } finally {
      working = false;
      close.disabled = false;
      add.removeAttribute('aria-busy');
      if (!added) add.textContent = label;
      sync();
      if (added) close.focus();
    }
  });

  // ── Closing ──
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    release?.();
    release = null;
    window.removeEventListener('hashchange', onNavigate);
    dlg.close();
    dlg.remove();
    if (previous?.isConnected) previous.focus();
  };
  /** Changed lines: ask before they are discarded (the console's own question, its words the panel's). */
  async function discardFirst(): Promise<boolean> {
    const ok = await openDialog({
      title: T.discardTitle,
      eyebrow: T.title,
      body: h('p', { class: 'dialog__text' }, T.discardBody),
      confirmLabel: T.discard,
      cancelLabel: T.stay,
      danger: true,
    });
    return ok !== null;
  }
  const leave = async () => {
    if (working) return;
    if (hold() && !(await discardFirst())) return;
    finish();
  };
  close.addEventListener('click', () => void leave());
  dlg.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    void leave();
  });
  // A draft's link followed, or the page left through the console (its own question asked when the page was held).
  function onNavigate(): void {
    if (heldMessage() === null) finish();
  }
  window.addEventListener('hashchange', onNavigate);
  result.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).closest('a[href]')) {
      release?.();
      release = null;
    }
  });

  document.body.appendChild(dlg);
  sync();
  dlg.showModal();
  model.focus();
}
