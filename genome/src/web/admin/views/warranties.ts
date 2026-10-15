/**
 * Warranties, filterable by computed status (NOT_STARTED, ACTIVE, EXPIRED, VOID); a lifetime warranty (plan ORBES CARE,
 * answer 12) reads End `Lifetime` and Months `—`. A second tab, Claims (`?tab=claims`): the warranty claims, those under
 * way first, then the others, newest first, filterable by step; a claim's page from its row.
 */
import { h } from '../../shared/dom.js';
import { formatDate, humanize } from '../format.js';
import {
  CLAIM_BASIS_SHORT,
  CLAIM_STATUS_LABELS,
  CLAIMS_EMPTY,
  CLAIMS_LEAD,
  claimHref,
  claimStatusFilter,
  outcomeText,
  WARRANTIES_LEAD,
  warrantiesTab,
  type WarrantiesTab,
} from '../model/claims.js';
import { toneOf } from '../model/tone.js';
import { href, productHref } from '../router.js';
import { WARRANTY_CLAIM_STATUSES, WARRANTY_STATUSES, type ClaimBoardRow } from '../types.js';
import { field, filterBar, pageHeader, pager, select, statusMark, table } from '../ui/components.js';
import { pageParam, type ViewContext } from './context.js';

/** The page's tabs: links, the current one marked (as the PRIVATE CARE board's). */
function tabs(current: WarrantiesTab): HTMLElement {
  const all: { value: WarrantiesTab; label: string }[] = [
    { value: 'warranties', label: 'Warranties' },
    { value: 'claims', label: 'Claims' },
  ];
  return h(
    'nav',
    { class: 'range care__tabs', attrs: { 'aria-label': 'Warranties' } },
    ...all.flatMap((t, i) => [
      i > 0 ? h('span', { class: 'range__dot', attrs: { 'aria-hidden': 'true' } }) : null,
      h(
        'a',
        { class: 'range__tab', attrs: { href: href('warranties', {}, t.value === 'claims' ? { tab: 'claims' } : {}), 'aria-current': t.value === current ? 'page' : null, 'data-testid': `warranties-tab-${t.value}` } },
        t.label,
      ),
    ]),
  );
}

export async function warrantiesView(ctx: ViewContext): Promise<HTMLElement> {
  const tab = warrantiesTab(ctx.route.query);
  if (tab === 'claims') return claimsTab(ctx);
  const status = ctx.route.query.status;
  const list = await ctx.api.warranties({ status, page: pageParam(ctx), pageSize: 50 });
  const filter = select('status', [{ value: '', label: 'All' }, ...WARRANTY_STATUSES.map((s) => ({ value: s, label: humanize(s) }))], status ?? '');
  filter.addEventListener('change', () => ctx.setQuery({ status: filter.value, page: undefined }));
  return h(
    'div',
    { class: 'view view--warranties' },
    pageHeader({ eyebrow: 'Clients', title: 'Warranties', lead: WARRANTIES_LEAD }),
    tabs(tab),
    filterBar(field('Status', filter)),
    table(
      [
        { label: 'Product', cell: (w) => h('a', { class: 'idlink', attrs: { href: productHref(w.productId) } }, w.productId), kind: ['nowrap'] },
        { label: 'Status', cell: (w) => statusMark(humanize(w.status), toneOf('warranty', w.status)), kind: ['nowrap'] },
        { label: 'Start', cell: (w) => formatDate(w.startDate), kind: ['nowrap'] },
        { label: 'End', cell: (w) => (w.lifetime ? 'Lifetime' : formatDate(w.endDate)), kind: ['nowrap'] },
        { label: 'Months', cell: (w) => (w.lifetime ? '—' : String(w.durationMonths)), kind: ['num'] },
        { label: 'Point of sale', cell: (w) => w.retailer ?? '—', kind: ['wide'] },
        { label: 'Country', cell: (w) => w.country ?? '—', kind: ['nowrap'] },
        { label: 'Void', cell: (w) => (w.voidedAt ? h('span', { attrs: { title: w.voidReason ?? '' } }, formatDate(w.voidedAt)) : '—'), kind: ['nowrap'] },
      ],
      list.items,
      { empty: status ? 'No warranty with this status.' : 'No warranty yet.', onRow: (w) => productHref(w.productId), caption: 'Warranties' },
    ),
    pager(list, (p) => ctx.setQuery({ page: p })),
  );
}

async function claimsTab(ctx: ViewContext): Promise<HTMLElement> {
  const status = claimStatusFilter(ctx.route.query);
  const list = await ctx.api.warrantyClaims({ ...(status ? { status } : {}), page: pageParam(ctx), pageSize: 50 });
  const filter = select('status', [{ value: '', label: 'All' }, ...WARRANTY_CLAIM_STATUSES.map((s) => ({ value: s, label: CLAIM_STATUS_LABELS[s] }))], status ?? '');
  filter.addEventListener('change', () => ctx.setQuery({ status: filter.value, page: undefined }));
  return h(
    'div',
    { class: 'view view--warranties view--claims' },
    pageHeader({ eyebrow: 'Clients', title: 'Warranties', lead: CLAIMS_LEAD }),
    tabs('claims'),
    filterBar(field('Status', filter)),
    table<ClaimBoardRow>(
      [
        { label: 'Opened', cell: (r) => formatDate(r.openedAt), kind: ['nowrap'] },
        {
          label: 'Piece',
          cell: (r) => h('span', null, h('a', { class: 'idlink', attrs: { href: productHref(r.piece.productId), 'data-testid': 'claim-row-piece' } }, r.piece.productId), h('span', { class: 'cell-sub' }, r.piece.model)),
          kind: ['nowrap'],
        },
        { label: 'Client', cell: (r) => (r.account ? h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: r.account.id }) } }, r.account.email) : 'No ORBES account'), kind: ['nowrap'] },
        { label: 'Basis', cell: (r) => CLAIM_BASIS_SHORT[r.basis], kind: ['nowrap'] },
        { label: 'Status', cell: (r) => h('span', { attrs: { 'data-testid': 'claim-row-status' } }, statusMark(CLAIM_STATUS_LABELS[r.status], toneOf('claim', r.status))), kind: ['nowrap'] },
        { label: 'Outcome', cell: (r) => outcomeText(r.outcome), kind: ['nowrap'] },
      ],
      list.items,
      { empty: CLAIMS_EMPTY, onRow: (r) => claimHref(r.id), caption: 'Warranty claims' },
    ),
    pager(list, (p) => ctx.setQuery({ page: p })),
  );
}
