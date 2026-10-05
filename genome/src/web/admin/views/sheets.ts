/**
 * The work sheets of the atelier, `#/atelier/sheets` (plan LIVE RELEASE+, choice 15 and The console → Atelier): one
 * printable page per piece to make, black on white in the house style: the piece's reference (O26-J-00184) and its
 * ORBES code drawn at print size (30 mm, the brand's minimum: the code of its reserved identity, which /verify answers
 * as unknown until the piece is issued), the model, the size, the add-ons, the engraving text and the surprise.
 *
 * The page asks for its sheets when it opens (`?id=` one piece, or `?origin=&skuId=&locationId=` the open pieces they
 * keep, at most 100): an OPERATOR's request, audited, since each sheet carries a code that verifies once the piece is
 * issued. PRINT prints the sheets alone, one per page.
 */
import { h, parseSvg } from '../../shared/dom.js';
import { formatDate, formatDateTime } from '../format.js';
import { ATELIER_LIMITS, sheetsSelection } from '../model/atelier.js';
import { CHANNEL_LABELS } from '../model/orders.js';
import { can } from '../model/permissions.js';
import { href } from '../router.js';
import type { WorkSheet } from '../types.js';
import { button, emptyState, linkButton, pageHeader } from '../ui/components.js';
import { codeSvgMarkup } from '../ui/figures.js';
import type { ViewContext } from './context.js';

/** The width a sheet draws the code at (styles.css `.worksheet__code svg`): the brand's minimum print size, quiet zone included. */
export const SHEET_CODE_MM = 30;

export async function workSheetsView(ctx: ViewContext): Promise<HTMLElement> {
  const back = linkButton('Back to the atelier', href('atelier'), 'ghost');
  if (!can(ctx.session.admin.role, 'printWorkSheets')) {
    return h(
      'div',
      { class: 'view view--print' },
      pageHeader({ eyebrow: 'Registry · Atelier', title: 'Work sheets', actions: [back] }),
      emptyState('A work sheet carries the piece’s ORBES code: an OPERATOR prints it.'),
    );
  }
  const { sheets, printedAt } = await ctx.api.workSheets(sheetsSelection(ctx.route.query));
  const print = button('Print', { kind: 'primary', testId: 'sheets-print', onClick: () => window.print() });
  return h(
    'div',
    { class: 'view view--print' },
    h(
      'div',
      { class: 'printbar' },
      h(
        'p',
        { class: 'printbar__text', data: { testid: 'sheets-count' } },
        sheets.length === 0
          ? 'No piece being made matches: nothing to print.'
          : `${sheets.length} ${sheets.length === 1 ? 'work sheet' : 'work sheets'}, one per page, at most ${ATELIER_LIMITS.sheets} at a time. Each code is printed at its size: never scale the page.`,
      ),
      h('div', { class: 'printbar__actions' }, back, sheets.length ? print : null),
    ),
    ...sheets.map((s) => sheet(s, printedAt)),
  );
}

function sheet(s: WorkSheet, printedAt: string): HTMLElement {
  const svg = parseSvg(codeSvgMarkup(s.code.data, s.code.glyphs, 'classic'));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `ORBES code of ${s.reference}`);
  const row = (label: string, value: string | null, testid?: string) =>
    h('div', { class: 'printdoc__row' }, h('dt', { class: 'printdoc__label' }, label), h('dd', { class: 'printdoc__value', data: testid ? { testid } : undefined }, value ?? 'None'));
  const forLine = s.order ? `${s.release ?? CHANNEL_LABELS[s.order.channel]} · order ${s.order.reference}` : 'The stock';
  return h(
    'article',
    { class: ['printdoc', 'printdoc--sheet'], attrs: { lang: 'en', 'aria-label': `Work sheet ${s.reference}` }, data: { testid: 'work-sheet', reference: s.reference } },
    h('header', { class: 'printdoc__head' }, h('span', { class: ['wordmark', 'printdoc__wordmark'] }, 'Orbes'), h('h1', { class: 'printdoc__title' }, 'Work sheet')),
    h(
      'div',
      { class: 'worksheet__identity' },
      h('figure', { class: 'worksheet__code', data: { testid: 'sheet-code' } }, svg),
      h('div', { class: 'worksheet__ref' }, h('p', { class: 'printdoc__label' }, 'Reference'), h('p', { class: 'worksheet__id', data: { testid: 'sheet-reference' } }, s.reference)),
    ),
    h(
      'dl',
      { class: 'printdoc__list' },
      row('Model', s.model),
      row('Size', s.sizeLabel ?? 'ONE SIZE', 'sheet-size'),
      row('SKU', s.skuCode),
      row('Add-ons', s.addons.length ? s.addons.join(' · ') : null, 'sheet-addons'),
      row('Engraving', s.engravingText, 'sheet-engraving'),
      row('Surprise', s.surprise, 'sheet-surprise'),
      row('For', forLine, 'sheet-for'),
      row('Goes to', s.location),
      row('To make since', formatDate(s.createdAt)),
    ),
    h('footer', { class: 'printdoc__foot' }, `Printed ${formatDateTime(printedAt)}. The code is this piece’s own: it verifies once the atelier issues the piece.`),
  );
}
