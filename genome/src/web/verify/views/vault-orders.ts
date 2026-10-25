/**
 * THE VAULT in YOUR ORDERS (lot Q3, step Q3.11; plan §3.8; D20, D29; N11, N12), phone and computer alike:
 *
 *   a piece won free      under its sentence ("Yours, free. … Yours until 27 NOVEMBER."): SIZE, its sizes with a unit
 *                         (its own preselected, the others greyed out once gone; THE PIECE's never changes), CLAIM IT;
 *                         without a delivery address, the sentence that asks for it (its DELIVERY ADDRESS block adds it,
 *                         D20 "YOUR ORDERS asks if none") and no CLAIM IT until it is there. Claimed, the order as any.
 *   a right to buy        FROM THE VAULT, the piece, "From THE VAULT, at its price. Until 21:14 in Paris.", PRICE, its
 *                         sizes, BUY: the order made at its usual price, then the order as any (its address, its payment).
 *
 * Each sends one request at a time (its button busy meanwhile); a refusal is said under it in the server's own words
 * (VAULT_OFFER_ENDED, VAULT_SIZE_NONE_LEFT, ORDER_ADDRESS_MISSING). CSP-safe: h() only.
 */
import { h } from '../../shared/dom.js';
import type { ApiClient } from '../api.js';
import { ORDERS, VAULT } from '../copy.js';
import { formatMoney } from '../view-model.js';
import type { OrderVaultClaimModel } from '../orders-model.js';
import type { SessionStore } from '../session.js';
import type { AccountOrder, VaultClaimSizesView, VaultRightToBuyView } from '../types.js';
import { parisTime } from '../vault-model.js';
import { withNumerals } from './common.js';
import { messageOf } from './forms.js';
import { button, definitionList, sizeButtons } from './nocturne.js';

export interface VaultOrderDeps {
  api: Pick<ApiClient, 'vaultClaimSizes' | 'claimVaultOrder' | 'buyVault'>;
  session: Pick<SessionStore, 'noteError'>;
  /** The order the server answered (claimed, or bought): drawn again in its place. */
  onOrder(order: AccountOrder): void;
}

/** CLAIM IT on a piece won free, under its sentence. */
export function vaultClaimBlock(m: OrderVaultClaimModel, deps: VaultOrderDeps): HTMLElement {
  const block = h('div', { class: 'n-vault-claim', data: { focus: 'claim' } });
  let sizes: VaultClaimSizesView | null = null;
  let chosen: string | null = null;
  let busy = false;
  let error: string | null = null;
  const draw = (): void => {
    const parts: (HTMLElement | null)[] = [];
    const choices = sizes ? sizes.sizes.filter((z) => z.label !== null) : [];
    if (sizes && choices.length > 1 && !sizes.sizeFixed) {
      const gone = new Set(choices.filter((z) => !z.available && !z.current).map((z) => z.label!));
      parts.push(
        h('p', { class: 'n-g n-lb n-vault-claim__label', text: VAULT.orders.size }),
        sizeButtons(
          choices.map((z) => ({ id: z.label!, label: z.label! })),
          {
            selected: chosen,
            label: VAULT.orders.size,
            unavailable: gone,
            onSelect: (id) => {
              chosen = id;
              draw();
            },
          },
        ),
      );
    }
    if (m.needsAddress) parts.push(h('p', { class: 'n-sm n-vault-claim__address', text: VAULT.orders.addressMissing }));
    parts.push(
      h(
        'p',
        { class: 'n-vault-claim__actions' },
        button(VAULT.orders.claim, {
          onClick: () => void claim(),
          extraClass: 'n-vault-claim__claim',
          attrs: { disabled: busy || m.needsAddress, 'aria-busy': busy ? 'true' : 'false', 'aria-label': m.label },
        }),
      ),
    );
    if (error) parts.push(h('p', { class: 'n-err n-vault-claim__error', attrs: { role: 'alert' }, text: error }));
    block.replaceChildren(...parts.filter((x): x is HTMLElement => x !== null));
  };
  const claim = async (): Promise<void> => {
    if (busy || m.needsAddress) return;
    busy = true;
    error = null;
    draw();
    try {
      const order = await deps.api.claimVaultOrder(m.orderId, sizes && chosen !== sizes.size ? { size: chosen } : {});
      busy = false;
      deps.onOrder(order);
      return;
    } catch (e) {
      deps.session.noteError(e);
      error = messageOf(e) || VAULT.orders.failed;
    }
    busy = false;
    draw();
  };
  draw();
  void deps.api.vaultClaimSizes(m.orderId).then(
    (s) => {
      sizes = s;
      // The size reserved at the opening: YOUR SIZES' (else the one with the most stock), as the server chose it.
      chosen = s.size;
      draw();
    },
    () => undefined,
  );
  return block;
}

/** A right to buy (24 hours), at the head of YOUR ORDERS. */
export function rightToBuyCard(r: VaultRightToBuyView, deps: VaultOrderDeps): HTMLElement {
  const titleId = `right-${r.vaultId}`;
  const sizes = (Array.isArray(r.sizes) ? r.sizes : []).filter((z): z is string => typeof z === 'string' && z !== '');
  // YOUR SIZES' size preselected (plan CUSTOMER INTELLIGENCE §3.7), the only one otherwise.
  let chosen: string | null = typeof r.savedSize === 'string' && sizes.includes(r.savedSize) ? r.savedSize : sizes.length === 1 ? sizes[0]! : null;
  let busy = false;
  let error: string | null = null;
  const body = h('div', { class: 'n-vault-buy__body' });
  const draw = (): void => {
    body.replaceChildren(
      ...([
        sizes.length > 1
          ? h(
              'div',
              { class: 'n-vault-buy__sizes' },
              h('p', { class: 'n-g n-lb', text: VAULT.orders.size }),
              sizeButtons(
                sizes.map((z) => ({ id: z, label: z })),
                {
                  selected: chosen,
                  label: VAULT.orders.size,
                  onSelect: (id) => {
                    chosen = id;
                    draw();
                  },
                },
              ),
            )
          : null,
        h(
          'p',
          { class: 'n-vault-buy__actions' },
          button(VAULT.orders.buy, {
            onClick: () => void buy(),
            extraClass: 'n-vault-buy__buy',
            attrs: { disabled: busy || (sizes.length > 1 && chosen === null), 'aria-busy': busy ? 'true' : 'false', 'aria-label': VAULT.orders.buyLabel(r.name) },
          }),
        ),
        error ? h('p', { class: 'n-err n-vault-buy__error', attrs: { role: 'alert' }, text: error }) : null,
      ] as (HTMLElement | null)[]).filter((x): x is HTMLElement => x !== null),
    );
  };
  const buy = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    error = null;
    draw();
    try {
      const order = await deps.api.buyVault(r.vaultId, chosen !== null ? { size: chosen } : {});
      busy = false;
      deps.onOrder(order);
      return;
    } catch (e) {
      deps.session.noteError(e);
      error = messageOf(e) || VAULT.orders.failed;
    }
    busy = false;
    draw();
  };
  draw();
  const time = parisTime(r.offerUntil);
  return h(
    'article',
    { class: 'n-px n-pieces__order n-pieces__order--bare n-vault-buy', attrs: { 'aria-labelledby': titleId }, data: { vault: r.vaultId } },
    h(
      'div',
      { class: 'n-pieces__words' },
      h('p', { class: 'n-g n-lb n-pieces__order-line', text: VAULT.orders.from }),
      h('h2', { class: 'n-g n-t2 n-pieces__order-title', id: titleId }, ...withNumerals(r.name)),
      time ? h('p', { class: 'n-tx n-pieces__order-sentence' }, ...withNumerals(VAULT.orders.buySentence(time))) : null,
      h('div', { class: 'n-pieces__order-rows' }, definitionList([[ORDERS.rows.price, formatMoney(r.priceMinor, r.currency)]], { kind: 'kv' })),
      body,
    ),
  );
}
