/**
 * Codes registry: every signed code with its issue, key, status and payload
 * hash. Read views never carry the scannable data (the API withholds it).
 * Filters, kept in the URL: production batch, model, code status and the
 * days the code was issued (GET /api/admin/codes).
 *
 * Print sheet (OPERATOR and above): select printable codes in the list
 * (ACTIVE, of a product that may still be printed: the list's `printable`),
 * page after page, or every printable code of the filters at once ("Select the
 * 120 codes of this batch", GET /api/admin/codes/ids). The layout shows
 * before anything is rendered ("35 per A4 · 4 pages", the core's
 * layoutSheet), then one PDF with labelled codes and crop marks
 * (POST /api/admin/codes/print-sheet), in parts of 200 codes, and its
 * manifest: which label goes on which piece (…/print-sheet/manifest). Every
 * code on a sheet is audited.
 */
import { h } from '../../shared/dom.js';
import { formatCount, formatDate, humanize, shortHash, versionLabel } from '../format.js';
import {
  ARTIFACT_LIMITS,
  artifactSizeAdvice,
  batchSelectLabel,
  buildPrintSheetOptions,
  codeFilterKey,
  codeFiltersFrom,
  hasCodeFilters,
  isSheetSelectable,
  printSheetPreview,
  pruneSheetSelection,
  PRINT_SHEET_LIMITS,
  SHEET_CODE_REFUSALS,
  sheetChunks,
  sheetPartFilename,
  sheetRefusalText,
  THEME_OPTIONS,
  type PrintSheetForm,
} from '../model/generator.js';
import { can } from '../model/permissions.js';
import { toneOf } from '../model/tone.js';
import { productHref } from '../router.js';
import { CODE_STATUSES, type CodeFilters, type CodeIds, type CodeJson, type Model } from '../types.js';
import { ApiError, type Download, type PrintSheetOptions } from '../api.js';
import {
  busy,
  button,
  checkbox,
  field,
  filterBar,
  input,
  mono,
  pageHeader,
  pager,
  section,
  select,
  statusMark,
  table,
  type Column,
} from '../ui/components.js';
import { saveDownload } from '../ui/download.js';
import { notifyError } from '../ui/toast.js';
import { pageParam, type ViewContext } from './context.js';

/** Production default for sheets: the brand minimum print size. */
const SHEET_WIDTH_MM = 30;

/**
 * The print-sheet selection, kept in memory (like the product page's fresh
 * code) so it survives moving through the list's pages; it belongs to the
 * filters it was made under and is dropped when they change.
 */
let sheetSelection: { key: string; ids: Set<string> } = { key: codeFilterKey({}), ids: new Set() };

/** Forget the selection. Called whenever the session ends, so the next admin on this tab starts empty. */
export function resetCodesViewState(): void {
  sheetSelection = { key: codeFilterKey({}), ids: new Set() };
}

export async function codesView(ctx: ViewContext): Promise<HTMLElement> {
  const filters = codeFiltersFrom(ctx.route.query);
  const key = codeFilterKey(filters);
  if (sheetSelection.key !== key) sheetSelection = { key, ids: new Set() };
  const selected = sheetSelection.ids;
  const canPrint = can(ctx.session.admin.role, 'download');
  const [list, models, batch] = await Promise.all([
    ctx.api.codes(filters, pageParam(ctx), 50),
    ctx.api.models(),
    canPrint && hasCodeFilters(filters) ? ctx.api.codeIds(filters) : Promise.resolve(null),
  ]);

  // Codes picked earlier that can no longer be printed (revoked since, their piece lost, stolen, retired…).
  const dropped = canPrint ? pruneSheetSelection(selected, list.items, batch) : [];

  const boxes: HTMLInputElement[] = [];
  const listeners: (() => void)[] = [];
  const changed = () => {
    for (const box of boxes) box.checked = selected.has(box.value);
    for (const fn of listeners) fn();
  };

  const columns: Column<CodeJson>[] = [
    { label: 'Product', cell: (c) => h('a', { class: 'idlink', attrs: { href: productHref(c.productId) } }, c.productId), kind: ['nowrap'] },
    { label: 'Issue', cell: (c) => String(c.issue), kind: ['num'] },
    { label: 'Status', cell: (c) => statusMark(humanize(c.status), toneOf('code', c.status)), kind: ['nowrap'] },
    { label: 'Version', cell: (c) => versionLabel('CODE', c.codeVersion), kind: ['nowrap'] },
    { label: 'Key', cell: (c) => mono(`#${c.keyId}`), kind: ['nowrap'] },
    { label: 'Issued', cell: (c) => formatDate(c.issuedAt), kind: ['nowrap'] },
    { label: 'Payload SHA-256', cell: (c) => mono(c.payloadHash, shortHash(c.payloadHash, 12, 6)), kind: ['wide'] },
    { label: 'Code id', cell: (c) => mono(c.id, shortHash(c.id, 8, 4)), kind: ['nowrap'] },
    { label: 'Revoked', cell: (c) => (c.revokedAt ? h('span', { attrs: { title: c.revocationReason ?? '' } }, formatDate(c.revokedAt)) : '—'), kind: ['nowrap'] },
  ];
  if (canPrint) {
    columns.unshift({
      label: 'Sheet',
      kind: ['nowrap'],
      cell: (c) => {
        if (!isSheetSelectable(c)) return '';
        const box = h('input', {
          class: 'sheet__pick',
          attrs: { type: 'checkbox', 'aria-label': `Add ${c.productId} issue ${c.issue} to the print sheet`, 'data-testid': 'sheet-select', value: c.id },
        });
        box.checked = selected.has(c.id);
        box.addEventListener('change', () => {
          if (box.checked) selected.add(c.id);
          else selected.delete(c.id);
          changed();
        });
        boxes.push(box);
        return box;
      },
    });
  }

  const filtered = hasCodeFilters(filters);
  return h(
    'div',
    { class: 'view view--codes' },
    pageHeader({ eyebrow: 'Registry', title: 'Codes', lead: 'Signed CODE-01 artifacts. A product may hold several issues; only one is ACTIVE.' }),
    filterForm(ctx, filters, models.items),
    canPrint ? printSheetPanel(ctx, filters, batch, selected, changed, listeners, dropped.length) : null,
    table(columns, list.items, { empty: filtered ? 'No code matches these filters.' : 'No code yet.', onRow: (c) => productHref(c.productId), caption: 'Codes' }),
    pager(list, (p) => ctx.setQuery({ page: p })),
  );
}

function filterForm(ctx: ViewContext, f: CodeFilters, models: readonly Model[]): HTMLElement {
  const batch = input('productionBatch', { value: f.productionBatch ?? '', placeholder: 'e.g. B-2026-09-A', maxlength: 100, mono: true });
  const sorted = [...models].sort((a, b) => a.name.localeCompare(b.name) || a.skuPrefix.localeCompare(b.skuPrefix));
  const model = select(
    'modelId',
    [{ value: '', label: 'All models' }, ...sorted.map((m) => ({ value: m.id, label: `${humanize(m.name)} · ${humanize(m.type)} · ${m.skuPrefix}` }))],
    f.modelId ?? '',
  );
  const status = select('status', [{ value: '', label: 'All statuses' }, ...CODE_STATUSES.map((s) => ({ value: s, label: humanize(s) }))], f.status ?? '');
  const from = input('issuedFrom', { type: 'date', value: f.issuedFrom ?? '' });
  const to = input('issuedTo', { type: 'date', value: f.issuedTo ?? '' });
  // The browser refuses a last day before the first one (its own validation message, before submit).
  const bound = () => {
    to.min = from.value;
    from.max = to.value;
  };
  from.addEventListener('change', bound);
  to.addEventListener('change', bound);
  bound();
  const form = h(
    'form',
    { class: 'filters__form', attrs: { role: 'search', 'aria-label': 'Filter codes' } },
    filterBar(
      field('Production batch', batch),
      field('Model', model),
      field('Status', status),
      field('Issued from', from),
      field('Issued to', to),
      button('Apply', { type: 'submit', kind: 'secondary', testId: 'codes-apply' }),
    ),
  );
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    ctx.setQuery({ productionBatch: batch.value.trim(), modelId: model.value, status: status.value, issuedFrom: from.value, issuedTo: to.value, page: undefined });
  });
  model.addEventListener('change', () => form.requestSubmit());
  status.addEventListener('change', () => form.requestSubmit());
  return form;
}

function printSheetPanel(
  ctx: ViewContext,
  filters: CodeFilters,
  batch: CodeIds | null,
  selected: Set<string>,
  changed: () => void,
  listeners: (() => void)[],
  dropped: number,
): HTMLElement {
  const width = input('sheetWidthMm', { type: 'number', value: String(SHEET_WIDTH_MM), min: ARTIFACT_LIMITS.minWidthMm, max: 100, step: '0.5', inputmode: 'decimal' });
  const theme = select('sheetTheme', [...THEME_OPTIONS], 'classic');
  const page = select(
    'sheetPage',
    PRINT_SHEET_LIMITS.pages.map((p) => ({ value: p, label: p })),
    'A4',
  );
  const label = checkbox('sheetLabel', 'Labels (product id + ORBES)', true);
  const decor = checkbox('sheetDecor', 'Decorative hairlines', true);
  const testPrint = checkbox('sheetTestPrint', 'Test print (allows widths under 15 mm)', false);
  const kOnly = checkbox('sheetKOnly', 'K-only black (print shops)', false);
  const advice = h('p', { class: 'artifact__size', attrs: { 'aria-live': 'polite' } });
  const preview = h('p', { class: 'sheet__preview', attrs: { 'aria-live': 'polite' }, data: { testid: 'sheet-preview' } });
  const count = h('span', { class: 'sheet__count', data: { testid: 'sheet-count' } });
  const error = h('p', { class: 'artifact__error', attrs: { role: 'alert' } });
  const checked = (box: HTMLLabelElement) => (box.querySelector('input') as HTMLInputElement).checked;
  const form = (): PrintSheetForm => ({
    widthMm: width.value,
    theme: theme.value,
    page: page.value,
    label: checked(label),
    decor: checked(decor),
    testPrint: checked(testPrint),
    kOnly: checked(kOnly),
    dpi: '',
  });
  const renderAdvice = () => {
    const a = artifactSizeAdvice(Number(width.value), checked(testPrint));
    advice.textContent = a.level === 'ok' ? '' : a.message;
    advice.classList.toggle('artifact__size--refuse', a.level === 'refuse');
  };
  const clear = button('Clear selection', { kind: 'ghost', testId: 'sheet-clear' });
  clear.addEventListener('click', () => {
    selected.clear();
    changed();
  });
  const renderSelection = () => {
    const n = selected.size;
    count.textContent = n === 0 ? 'No code selected' : `${formatCount(n)} code${n === 1 ? '' : 's'} selected`;
    preview.textContent = printSheetPreview(form(), n).text;
    clear.disabled = n === 0;
  };
  listeners.push(renderSelection);
  width.addEventListener('input', () => {
    renderAdvice();
    renderSelection();
  });
  testPrint.addEventListener('change', renderAdvice);
  page.addEventListener('change', renderSelection);
  label.addEventListener('change', renderSelection);

  /** Request the selection part by part (200 codes each, the order of the selection) and save every file. */
  const download = (btn: HTMLButtonElement, fetchPart: (ids: string[], opts: PrintSheetOptions) => Promise<Download>, working: string, failure: string) => {
    error.textContent = '';
    const opts = buildPrintSheetOptions(form(), selected.size);
    if (!opts.ok) {
      error.textContent = Object.values(opts.errors).join(' ');
      return;
    }
    const parts = sheetChunks([...selected]);
    void busy(btn, async () => {
      for (let i = 0; i < parts.length; i++) {
        try {
          const d = await fetchPart(parts[i], opts.value);
          saveDownload({ ...d, filename: sheetPartFilename(d.filename, i + 1, parts.length) });
        } catch (e) {
          notifyError(e, failure);
          const lines: string[] = [];
          if (parts.length > 1) lines.push(`Part ${i + 1} of ${parts.length} could not be produced${i > 0 ? '; the parts before it were saved' : ''}.`);
          // A code of the selection that can no longer be printed: the server names its piece.
          if (e instanceof ApiError && SHEET_CODE_REFUSALS.includes(e.code)) lines.push(sheetRefusalText(e.message));
          error.textContent = lines.join(' ');
          return;
        }
      }
    }, working);
  };
  const go = button('Download print sheet', { kind: 'secondary', testId: 'download-sheet' });
  go.addEventListener('click', () => download(go, (ids, opts) => ctx.api.printSheet(ids, opts), 'Rendering…', 'The print sheet could not be produced.'));
  const manifest = button('Download manifest', { kind: 'ghost', testId: 'download-manifest' });
  manifest.addEventListener('click', () => download(manifest, (ids, opts) => ctx.api.printSheetManifest(ids, opts), 'Preparing…', 'The manifest could not be produced.'));

  renderAdvice();
  renderSelection();
  const droppedNote =
    dropped > 0
      ? h(
          'p',
          { class: 'sheet__batch-note', attrs: { role: 'status' }, data: { testid: 'sheet-dropped' } },
          `${formatCount(dropped)} code${dropped === 1 ? '' : 's'} left the selection: no longer printable (revoked, or the piece can no longer be printed).`,
        )
      : null;
  return section(
    'Print sheet',
    [
      droppedNote,
      batchRow(filters, batch, selected, changed),
      h(
        'div',
        { class: 'grid grid--2' },
        field('Code width (mm)', width, { hint: '30 mm minimum for production' }),
        field('Theme', theme),
        field('Page', page),
        h('div', { class: 'cfield cfield--checks' }, label, decor, testPrint, kOnly),
      ),
      advice,
      h('div', { class: 'artifact__downloads' }, count, preview, clear, go, manifest),
      error,
      h(
        'p',
        { class: 'artifact__note' },
        `Select up to ${formatCount(PRINT_SHEET_LIMITS.maxSelection)} ACTIVE codes, in the list page after page or all those of the filters at once. ` +
          `Over ${PRINT_SHEET_LIMITS.maxCodes} codes the sheet comes as several PDFs of ${PRINT_SHEET_LIMITS.maxCodes} (the browser may ask to allow several downloads). ` +
          'One vector PDF with labels and crop marks; the manifest (CSV) gives the page, row and column of each piece, in the order of the PDF. Every code on a sheet is recorded in the audit log.',
      ),
    ],
    { class: 'panel--sheet' },
  );
}

/** "Select the 120 codes of this batch": every printable code of the filters, at most 1 000. */
function batchRow(filters: CodeFilters, batch: CodeIds | null, selected: Set<string>, changed: () => void): HTMLElement | null {
  if (!batch) {
    return h('p', { class: 'sheet__batch-note' }, 'Filter by production batch to select a whole batch at once.');
  }
  if (batch.ids.length === 0) return h('p', { class: 'sheet__batch-note' }, 'No printable code matches these filters.');
  const [before, count, after] = batchSelectLabel(filters, batch.ids.length);
  const pick = button('', { kind: 'secondary', testId: 'sheet-select-batch' });
  pick.append(before, h('span', { class: 'cbtn__figure' }, count), after);
  pick.addEventListener('click', () => {
    for (const id of batch.ids) selected.add(id);
    changed();
  });
  const note = batch.truncated
    ? h(
        'p',
        { class: 'sheet__batch-note' },
        `Only the first ${formatCount(batch.ids.length)} of ${formatCount(batch.total)} printable codes are selected at once: narrow the filters (issue days) to print the rest.`,
      )
    : null;
  return h('div', { class: 'sheet__batch' }, pick, note);
}
