/**
 * THE VAULT's products (lot Q3, step Q3.7; plan §2.4 PRODUCT, VAULT_EDITION, THE_PIECE, §2.5, §4.5; vault/SCOPE.md E7
 * "any catalogue product, set FREE (a normal order) or RIGHT TO BUY (24 h, its usual price); rare VAULT EDITION (catalogue
 * product marked vault-only, never sold); rarer THE PIECE (the missed model, your size, free)", E8 "A product won free:
 * default address (YOUR ORDERS asks if none), shipped free, claimed within 30 days or back to stock; a won piece gets its
 * ORBES identity and counts toward the tier", round 2 "Right to buy: 24 HOURS, at its usual price", round 3 "i must be
 * able to select any product from the catalog, define its odds and if it's free or at the price"):
 *
 *   the unit     `vaultUnit`: a product won FREE, a VAULT EDITION and THE PIECE hold a unit for the winner from the
 *                opening on (N12, D20 "a unit set aside for the winner until the claim"), taken from the house's
 *                sellable stock (its default location) as an order's piece is taken, under its SKU's lock: the size
 *                YOUR SIZES preselects among the sizes with stock, else the size with the most stock; THE PIECE's own
 *                size only (the entry's). No unit in any size: the row cannot give (its odds go to the card, E1).
 *   the order    `vaultFreeOrder`: a VAULT order at 0 (shipping 0), in the opening's transaction, holding that unit
 *                (STOCK) with its 30 days to be claimed (`claim_by`, the Paris day of the opening its first), the
 *                account's default address (as every order of its own).
 *   the claim    VaultService.claim (POST /api/v1/account/orders/:id/claim, step Q3.9): the size changed only to one with
 *                stock (the reserved unit swaps; 409 VAULT_SIZE_NONE_LEFT refuses only that change; THE PIECE's size never
 *                changes), the address (the default one, or one given; 409 ORDER_ADDRESS_MISSING without one), then PAID
 *                at 0 with its invoice: the Orders board packs it with its card scan, the piece gets its ORBES identity at
 *                registration and counts toward the tier, and opens no vault of its own (N8: services/vault.ts
 *                pieceBought).
 *   unclaimed    the housekeeping job `vaults` (VaultService.expireClaims): a VAULT order at 0 still RESERVED at its
 *                `claim_by` is CANCELLED, its reserved unit back to stock where it serves the next order waiting
 *                (D20 "claimed within 30 days or back to stock"); audited `vault.claim_expired`.
 *   right to buy VaultService.buy (POST /api/v1/account/vaults/:id/buy): within the vault's 24 hours (`offer_until`), a
 *                VAULT order at the model's usual price (its base price, a variant's own or else its main model's, in its
 *                currency, as the salon prices it), shipping as the tier gives it, held as any order (STOCK, or AWAITING
 *                supplier stock), paid as every platform order (Client Services marks it PAID; later a Shopify checkout
 *                for that exact order, S2); its piece opens a vault at its registration like any bought piece (N8). An
 *                add-on's right to buy is ADD on an order before packing, at its price (services/order-addons.ts).
 *   vault-only   §4.5 "a vault-only model is refused by every sales path: draws, LIVE releases, the salon, YOUR WISHLIST,
 *                the Shopify export's sellable lines" (E7 "never sold"): `assertSellable` (409 MODEL_VAULT_ONLY); the
 *                lookbook, not a sales path, is unchanged.
 */
import type { Db } from '../db/connection.js';
import { HOUSE_CURRENCIES, type HouseCurrency, type OrderRow } from '../db/schema.js';
import { conflict } from '../errors.js';
import type { Actor } from '../types.js';
import type { AuditRecordInput } from './audit.js';
import { createOrder, shippingFor } from './orders.js';
import { savedSizeAmong } from './sizes.js';
import { compareSizes, defaultLocationId, lockSku, stockLevel } from './stock.js';

/** 409 MODEL_VAULT_ONLY: a model marked vault-only offered by a sales path (E7 "never sold"). */
export const modelVaultOnly = () => conflict('MODEL_VAULT_ONLY', 'This model is made only for the vault: it is never sold.');
/** 409 VAULT_SIZE_NONE_LEFT: a change of size at the claim to a size with no unit left (the reserved unit itself is never refused). */
export const vaultSizeNoneLeft = () => conflict('VAULT_SIZE_NONE_LEFT', 'None is left in that size. Your piece stays in its size.');
/** 409 VAULT_OFFER_ENDED: a right to buy past its 24 hours, a piece won free past its 30 days to be claimed. */
export const vaultOfferEnded = (words = 'This offer has ended.') => conflict('VAULT_OFFER_ENDED', words);
/** 409 ORDER_ADDRESS_MISSING: a piece won free claimed without a delivery address. */
export const vaultAddressMissing = () => conflict('ORDER_ADDRESS_MISSING', 'Enter the delivery address to claim it.');

/**
 * Refuses a sales path any vault-only model among `modelIds` (§4.5; 409 MODEL_VAULT_ONLY), read in the caller's
 * transaction. Nulls are skipped.
 */
export async function assertSellable(db: Db, modelIds: readonly (string | null | undefined)[]): Promise<void> {
  const ids = [...new Set(modelIds.filter((x): x is string => typeof x === 'string'))];
  if (ids.length === 0) return;
  const only = await db.selectFrom('models').select('id').where('id', 'in', ids).where('vault_only', '=', true).executeTakeFirst();
  if (only) throw modelVaultOnly();
}

/** Refuses a set whose pieces name a vault-only model (a set's release sells each of them; §4.5). */
export async function assertSetSellable(db: Db, setId: string): Promise<void> {
  const only = await db
    .selectFrom('set_models as s')
    .innerJoin('models as m', 'm.id', 's.model_id')
    .select('m.id')
    .where('s.set_id', '=', setId)
    .where('m.vault_only', '=', true)
    .executeTakeFirst();
  if (only) throw modelVaultOnly();
}

/** The unit reserved for a winner: its SKU, its size (null: ONE SIZE), at the house's location. */
export interface VaultUnit {
  modelId: string;
  skuId: string;
  label: string | null;
  locationId: string;
}

/**
 * The unit a winner is given at the opening (N12; see the header), its SKU locked (`lockSku`) and its unit available
 * read again under the lock, in the opening's transaction: among the model's offered sizes with a unit available at the
 * house's location, the one YOUR SIZES preselects, else the one with the most (ties in the order a client reads sizes);
 * `size` given (THE PIECE: the entry's size, whatever its case; null: ONE SIZE), that size only. Null when none has a
 * unit.
 */
export async function vaultUnit(tx: Db, accountId: string, modelId: string, size?: string | null): Promise<VaultUnit | null> {
  const locationId = await defaultLocationId(tx);
  const skus = (await tx.selectFrom('skus').select(['id', 'size_label', 'fit_min_mm', 'fit_max_mm']).where('model_id', '=', modelId).where('set_aside_at', 'is', null).execute())
    .filter((k) => size === undefined || (size === null ? k.size_label === null : (k.size_label ?? '').toUpperCase() === size.toUpperCase()))
    .sort((a, b) => compareSizes(a.size_label, b.size_label) || (a.id < b.id ? -1 : 1));
  const stocked: { id: string; label: string | null; fitMinMm: number | null; fitMaxMm: number | null; stock: number }[] = [];
  for (const k of skus) {
    const available = (await stockLevel(tx, k.id, locationId)).available;
    if (available >= 1) stocked.push({ id: k.id, label: k.size_label, fitMinMm: k.fit_min_mm, fitMaxMm: k.fit_max_mm, stock: available });
  }
  if (stocked.length === 0) return null;
  const saved =
    size === undefined
      ? await savedSizeAmong(
          tx,
          accountId,
          modelId,
          stocked.filter((k) => k.label !== null).map((k) => ({ ...k, label: k.label! })),
        )
      : null;
  // The most stock first; Array.prototype.sort is stable, so ties keep the size order.
  const order = [...(saved ? [stocked.find((k) => k.id === saved.id)!] : []), ...[...stocked].sort((a, b) => b.stock - a.stock).filter((k) => k.id !== saved?.id)];
  for (const k of order) {
    await lockSku(tx, k.id);
    if ((await stockLevel(tx, k.id, locationId)).available >= 1) return { modelId, skuId: k.id, label: k.label, locationId };
  }
  return null;
}

/** A model's usual price (its base price: a variant's own, else its main model's) and its house currency; null without one. */
export async function usualPrice(db: Db, modelId: string): Promise<{ minor: number; currency: HouseCurrency } | null> {
  const m = await db
    .selectFrom('models as m')
    .leftJoin('models as mm', 'mm.id', 'm.variant_of')
    .select(['m.base_price_minor', 'm.base_currency', 'mm.base_price_minor as main_minor', 'mm.base_currency as main_currency'])
    .where('m.id', '=', modelId)
    .executeTakeFirst();
  if (!m) return null;
  const [minor, currency] = m.base_price_minor !== null ? [m.base_price_minor, m.base_currency] : [m.main_minor, m.main_currency];
  if (minor === null || typeof currency !== 'string' || !(HOUSE_CURRENCIES as readonly string[]).includes(currency)) return null;
  return { minor, currency: currency as HouseCurrency };
}

/**
 * The VAULT order of a product won FREE, a VAULT EDITION or THE PIECE (§2.4), in the opening's transaction: at 0 in the
 * model's base currency (EUR without one), shipping 0 (the tier's free service, else STANDARD), holding `unit` (STOCK)
 * until `claimBy`, the account's default address. Audited `order.create` (VAULT) by the account.
 */
export async function vaultFreeOrder(
  tx: Db,
  v: { id: string; account_id: string },
  unit: VaultUnit,
  claimBy: Date,
  now: Date,
  notes: AuditRecordInput[],
): Promise<OrderRow> {
  const currency = (await usualPrice(tx, unit.modelId))?.currency ?? 'EUR';
  const tiered = await shippingFor(tx, v.account_id, currency, now);
  const actor: Actor = { type: 'account', id: v.account_id };
  return createOrder(
    tx,
    {
      channel: 'VAULT',
      vaultId: v.id,
      dropId: null,
      accountId: v.account_id,
      modelId: unit.modelId,
      sizeLabel: unit.label,
      skuId: unit.skuId,
      priceMinor: 0,
      currency,
      addons: [],
      surprise: null,
      locationId: unit.locationId,
      // "Shipped free" (E8): the service the tier gives free, else STANDARD, at 0.
      shipping: { service: tiered.benefit !== null && tiered.service !== null ? tiered.service : 'STANDARD', minor: 0, benefit: null },
      claimBy,
      reservation: 'STOCK',
    },
    { hold: false },
    actor,
    now,
    notes,
  );
}

/** The VAULT orders at 0 still RESERVED past their `claim_by` at `now` (the housekeeping's), oldest first. */
export async function unclaimedVaultOrders(db: Db, now: Date, limit: number): Promise<string[]> {
  const rows = await db
    .selectFrom('orders')
    .select('id')
    .where('channel', '=', 'VAULT')
    .where('status', '=', 'RESERVED')
    .where('claim_by', 'is not', null)
    .where('claim_by', '<=', now)
    .orderBy('claim_by')
    .orderBy('id')
    .limit(limit)
    .execute();
  return rows.map((r) => r.id);
}

/** Whether a VAULT order is THE PIECE's (its size never changes at the claim). */
export async function isThePiece(db: Db, vaultId: string | null): Promise<boolean> {
  if (vaultId === null) return false;
  const r = await db.selectFrom('vaults').select('reward_kind').where('id', '=', vaultId).executeTakeFirst();
  return r?.reward_kind === 'THE_PIECE';
}
