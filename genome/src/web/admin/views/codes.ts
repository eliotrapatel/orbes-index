/**
 * Codes registry: every signed code with its issue, key, status and payload
 * hash. Read views never carry the scannable data (the API withholds it).
 *
 * Print sheet (OPERATOR and above): select ACTIVE codes in the list and
 * download one PDF with labelled codes and crop marks
 * (POST /api/admin/codes/print-sheet; every code on the sheet is audited).
 */
import { h } from '../../shared/dom.js';
import { formatDate, humanize, shortHash, versionLabel } from '../format.js';
import {
  ARTIFACT_LIMITS,
  artifactSizeAdvice,
  buildPrintSheetOptions,
  isSheetSelectable,
  PRINT_SHEET_LIMITS,
  THEME_OPTIONS,
  type PrintSheetForm,
} from '../model/generator.js';
import { can } from '../model/permissions.js';
import { toneOf } from '../model/tone.js';
import { productHref } from '../router.js';
import type { CodeJson } from '../types.js';
import { busy, button, checkbox, field, input, mono, pageHeader, pager, section, select, statusMark, table, type Column } from '../ui/components.js';
import { saveDownload } from '../ui/download.js';
import { notifyError } from '../ui/toast.js';
import { pageParam, type ViewContext } from './context.js';

/** Production default for sheets: the brand minimum print size. */
const SHEET_WIDTH_MM = 30;

export async function codesView(ctx: ViewContext): Promise<HTMLElement> {
  const list = await ctx.api.codes(pageParam(ctx), 50);
  const canPrint = can(ctx.session.admin.role, 'download');
  const selected = new Set<string>();
  const count = h('span', { class: 'sheet__count', data: { testid: 'sheet-count' } }, 'No code selected');
  const refreshCount = () => {
    count.textContent = selected.size === 0 ? 'No code selected' : `${selected.size} code${selected.size === 1 ? '' : 's'} selected`;
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
        box.addEventListener('change', () => {
          if (box.checked) selected.add(c.id);
          else selected.delete(c.id);
          refreshCount();
        });
        return box;
      },
    });
  }

  return h(
    'div',
    { class: 'view view--codes' },
    pageHeader({ eyebrow: 'Registry', title: 'Codes', lead: 'Signed CODE-01 artifacts. A product may hold several issues; only one is ACTIVE.' }),
    canPrint ? printSheetPanel(ctx, selected, count) : null,
    table(columns, list.items, { empty: 'No code yet.', onRow: (c) => productHref(c.productId), caption: 'Codes' }),
    pager(list, (p) => ctx.setQuery({ page: p })),
  );
}

function printSheetPanel(ctx: ViewContext, selected: ReadonlySet<string>, count: HTMLElement): HTMLElement {
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
  width.addEventListener('input', renderAdvice);
  testPrint.addEventListener('change', renderAdvice);

  const go = button('Download print sheet', { kind: 'secondary', testId: 'download-sheet' });
  go.addEventListener('click', () => {
    error.textContent = '';
    const opts = buildPrintSheetOptions(form(), selected.size);
    if (!opts.ok) {
      error.textContent = Object.values(opts.errors).join(' ');
      return;
    }
    void busy(go, async () => {
      try {
        saveDownload(await ctx.api.printSheet([...selected], opts.value));
      } catch (e) {
        notifyError(e, 'The print sheet could not be produced.');
      }
    }, 'Rendering…');
  });

  renderAdvice();
  return section(
    'Print sheet',
    [
      h(
        'div',
        { class: 'grid grid--2' },
        field('Code width (mm)', width, { hint: '30 mm minimum for production' }),
        field('Theme', theme),
        field('Page', page),
        h('div', { class: 'cfield cfield--checks' }, label, decor, testPrint, kOnly),
      ),
      advice,
      h('div', { class: 'artifact__downloads' }, count, go),
      error,
      h('p', { class: 'artifact__note' }, `Select up to ${PRINT_SHEET_LIMITS.maxCodes} ACTIVE codes in the list. One vector PDF with labels and crop marks; every code on it is recorded in the audit log.`),
    ],
    { class: 'panel--sheet' },
  );
}
