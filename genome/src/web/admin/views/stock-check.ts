/**
 * A release's stock check in the console (plan NEXT LOT §3.5.4.3), shared by a LIVE RELEASE (views/live.ts) and a draw
 * with sizes (views/drop.ts): per size, the owner's sentence '52: 12 in stock, 13 will wait for supplier stock.', or
 * 'Every piece on sale is in stock.'; each short size with what is already ordered for it and, for an OPERATOR, Add to
 * supplier order; the line 'It does not block publishing: …'. Under the release's sizes from its creation on
 * (`stockBlock`), and in its PUBLISH dialog (`feasibilityBlock`). The check is a server read (GET
 * /api/admin/live/:id/feasibility, /api/admin/drops/:id/feasibility): a warning, never a refusal.
 *
 * `prefix` names the test ids, `live` for a LIVE RELEASE (as before this module), `drop` for a draw.
 */
import { h, type Child } from '../../shared/dom.js';
import { formatCount } from '../format.js';
import { addToOrderLine, feasibilityLine, orderedLine, toAddOf } from '../model/live.js';
import { can } from '../model/permissions.js';
import { noSupplierWords } from '../model/supplier-orders.js';
import type { LiveFeasibility } from '../types.js';
import { button } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify } from '../ui/toast.js';
import type { ViewContext } from './context.js';

/** The release the check is of: its model's name names a size without SKU words. */
export interface CheckedRelease {
  model: { name: string };
}

/** The test ids' prefix: a LIVE RELEASE's, or a draw's. */
export type StockCheckPrefix = 'live' | 'drop';

const NOT_BLOCKING = 'It does not block publishing: the orders the stock does not cover wait for supplier stock, the oldest first.';

/**
 * The feasibility check in the publish dialog: each size not covered, said, with its Add to supplier order (plan NEXT
 * LOT §3.5.4.3), the block read again once added (`read`); everything covered, said; unread, said.
 */
export function feasibilityBlock(
  ctx: ViewContext,
  r: CheckedRelease,
  check: LiveFeasibility | 'failed',
  read: () => Promise<LiveFeasibility>,
  prefix: StockCheckPrefix = 'live',
): HTMLElement {
  if (check === 'failed') return h('p', { class: 'dialog__text soft', data: { testid: `${prefix}-feasibility` } }, 'The stock could not be checked just now: the release can be published all the same.');
  const block: HTMLElement = h(
    'div',
    { class: 'live__feasibility', data: { testid: `${prefix}-feasibility` } },
    h('p', { class: 'live__feasibility-title' }, 'Stock'),
    h('p', { class: 'dialog__text', data: { testid: `${prefix}-feasibility-line` } }, feasibilityLine(check)),
    shortSizesList(ctx, r, check, `${prefix}-feasibility-warning`, prefix, async () => {
      const again: LiveFeasibility | 'failed' = await read().catch(() => 'failed' as const);
      block.replaceWith(feasibilityBlock(ctx, r, again, read, prefix));
    }),
    check.short > 0 ? h('p', { class: 'dialog__text soft' }, NOT_BLOCKING) : null,
  );
  return block;
}

/**
 * The release's stock under its sizes (plan NEXT LOT §3.5.4.3), from its creation on: each size's sentence, and for a
 * size short of stock with a supplier, Add to supplier order (OPERATOR), into its supplier's draft for ORBES to confirm.
 */
export function stockBlock(ctx: ViewContext, r: CheckedRelease, check: LiveFeasibility | 'failed', prefix: StockCheckPrefix = 'live'): HTMLElement {
  if (check === 'failed') return h('p', { class: 'panel__text soft', data: { testid: `${prefix}-stock` } }, 'The stock could not be checked just now.');
  return h(
    'div',
    { class: 'live__stock', data: { testid: `${prefix}-stock` } },
    h('p', { class: 'dialog__text', data: { testid: `${prefix}-stock-line` } }, feasibilityLine(check)),
    shortSizesList(ctx, r, check, `${prefix}-stock-warning`, prefix, async () => ctx.reload()),
    check.short > 0 ? h('p', { class: 'dialog__text soft' }, NOT_BLOCKING) : null,
  );
}

/**
 * The sizes short of stock, the release's then its after-room's, each with the owner's sentence (the check's warning),
 * what is already ordered for it, and, for an OPERATOR, Add to supplier order with the pieces still to order (§3.5.6.4:
 * never a shortfall ordered twice); a size without a supplier says where to set one.
 */
function shortSizesList(ctx: ViewContext, r: CheckedRelease, check: LiveFeasibility, testId: string, prefix: StockCheckPrefix, added: () => Promise<void>): HTMLElement | null {
  const add = can(ctx.session.admin.role, 'manageSupplierOrders') && check.location !== null;
  const lines = [...check.sizes.map((l) => ({ l, before: '' })), ...(check.afterRoom ?? []).map((l) => ({ l, before: 'THE AFTER-ROOM · ' }))].filter((x) => x.l.short > 0);
  if (!lines.length) return null;
  return h(
    'ul',
    { class: 'live__feasibility-list' },
    ...lines.map(({ l, before }) => {
      // The SKU's words name the variant: 'MONOLITHE · BLUE · 52' (the release's model and size without one).
      const sku = l.skuWords ?? `${r.model.name} · ${l.label}`;
      const ordered = orderedLine(l);
      const after: Child[] = [];
      if (ordered) after.push(' ', h('span', { class: 'soft', data: { testid: `${prefix}-ordered` } }, ordered));
      if (add && l.skuId && !l.supplier) after.push(' ', h('span', { class: 'soft', data: { testid: `${prefix}-no-supplier` } }, noSupplierWords(sku)));
      if (add && l.skuId && l.supplier && toAddOf(l) > 0) {
        after.push(
          ' ',
          button('Add to supplier order', {
            kind: 'ghost',
            testId: `${prefix}-add-to-order`,
            onClick: () =>
              void openDialog({
                title: 'Add to supplier order',
                eyebrow: sku,
                body: [ordered ? h('p', { class: 'dialog__text soft' }, ordered) : null, h('p', { class: 'dialog__text', data: { testid: `${prefix}-add-to-order-text` } }, addToOrderLine(l, sku, check.location!.name))],
                confirmLabel: 'Add to supplier order',
                submit: async () => {
                  await ctx.api.addToSupplierDraft({ skuId: l.skuId!, locationId: check.location!.id, quantity: toAddOf(l), from: 'RELEASE' });
                },
              }).then(async (v) => {
                if (!v) return;
                notify('Added to the draft.');
                await added();
              }),
          }),
        );
      }
      return h('li', { data: { testid: testId } }, h('span', null, `${before}${l.label}: ${formatCount(l.fromStock)} in stock, ${formatCount(l.short)} will wait for supplier stock.`), ...after);
    }),
  );
}
