/**
 * A new claim code shown once (only its hash is kept), with its certificate card to download (the 79t card, one per
 * page): a return to stock (views/order.ts, its text and testId `return-card` as before) and NEW CLAIM CODE for a piece
 * in stock (views/product.ts, plan NEXT LOT §3.4: its own text, testId `claim-card`). The code lives in this dialog only:
 * never in storage, never sent back except to draw its card.
 */
import { h } from '../../shared/dom.js';
import type { AdminApi } from '../api.js';
import { button, copyButton, mono } from './components.js';
import { openDialog } from './dialog.js';
import { saveDownload } from './download.js';
import { notifyError } from './toast.js';

export interface ClaimCodeDialogOptions {
  /** The piece, canonical id: the dialog's eyebrow and the card's product. */
  productId: string;
  code: string;
  /** What the code is for, above it. */
  text: string;
  /** The download button's test id. */
  testId: string;
}

/** Title 'Its new claim code', the text, the code, Copy the claim code and Download certificate card; Done or Close. */
export function claimCodeDialog(ctx: { api: Pick<AdminApi, 'certificates'> }, o: ClaimCodeDialogOptions): Promise<unknown> {
  const card = button('Download certificate card', { kind: 'ghost', testId: o.testId });
  card.addEventListener('click', async () => {
    card.disabled = true;
    try {
      saveDownload(await ctx.api.certificates([{ productId: o.productId, claimCode: o.code }], { format: 'pdf', layout: 'card' }));
    } catch (e) {
      notifyError(e, 'The certificate card could not be produced.');
    } finally {
      card.disabled = false;
    }
  });
  return openDialog({
    title: 'Its new claim code',
    eyebrow: o.productId,
    body: [
      h('p', { class: 'dialog__text' }, o.text),
      h('p', { class: 'claimcode', data: { testid: 'claim-code' } }, mono(o.code)),
      h('div', { class: 'row-actions' }, copyButton(o.code, 'Copy the claim code'), card),
    ],
    confirmLabel: 'Done',
    cancelLabel: 'Close',
  });
}
