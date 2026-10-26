/**
 * The margin's fixtures (lot M4 plan §1.5, step M4.3; test/services/margin.test.ts, test/api/admin-margin.test.ts): houses
 * written row by row as the services leave them, on GROWTH's fixture builder (test/support/growth.ts), so every figure of
 * the margin can be counted by hand. Each `seed…` returns the ids; the clock of the readings is MARGIN_NOW (window: Nov
 * 2025 to Oct 2026). Amounts in cents.
 *
 * ── seedMargin: the first plan's house (as the first attempt's a93d53fe counted it) ──────────────────────────────────
 *
 * The house before THE VAULT: its PIECE source is switched off, so no box holds THE VAULT CARD.
 *
 * Settings (as the owner would enter them): GBP at 1.2; bands FR up to 500 g € 6.90, FR up to 1 000 g € 9.90, ALL
 * OTHER COUNTRIES up to 1 000 g € 15.00; POUCH € 3.00, CARD € 2.00, CARE_SERVICE € 50.00, CLAIM_REFUSED € 10.00; the
 * allowance of J (Jewelry) 2.5 %; Q (Leather) none. Box BX: € 2.50, 100 g empty; HALO packs in it at 150 g.
 *
 * Supplier prices: SO1 (EUR, € 15.00 shipping over 15 units: € 1.00 a unit) HALO 52 (A) 10 at € 200, HALO 54 (B) 6 at
 * € 300 with one cancelled; SO2 (GBP, no shipping) A 10 at £ 150 (€ 180); SO3 (EUR) the CHARM add-on at € 15; SO4 (CHF,
 * no rate) ORBIT at CHF 100. A's average: € 190 and € 0.50 inbound.
 *
 *   O1   X (TITANE then: 1 piece; PLATINE later), SALON HALO A traced (SO1), FR, € 1 200 + € 15 shipping + a CHARM unit
 *        € 25; packed in BX at 400 g; a welcome GIFT HALO B traced travelling with it. Its piece's care DONE in Jun 2026.
 *   O2   Y (PALLADIUM: 10 pieces), LIVE HALO A traced, DE, free EXPRESS shipping (PALLADIUM), € 1 200 less a € 100
 *        credit; a supplementary invoice (engraving € 50, an add-on line € 20) and the add-on line credited. O3, LIVE HALO
 *        A not bound yet, travels with it: one parcel in BX at 900 g (ALL OTHER COUNTRIES).
 *   O4   Z (no piece), DRAW HALO A not bound, GB, £ 1 000, paid and not packed (an estimate: BX + 150 g = 250 g).
 *   O5   V, SALON HALO A, FR, returned for a size exchange: its EXCHANGE order E5 (HALO B traced), each its parcel in BX
 *        at 400 g; O5's piece restocked.
 *   O10  V, SALON HALO in Gold (a variant), FR: its first parcel LOST with its piece (traced A, revoked), reshipped with
 *        another (traced A) in a second parcel; each in BX at 400 g.
 *   S1   W, a set's draw: AURA (Q, no supplier price) € 600 and S2 ORBIT (J, priced in CHF only) € 400 travelling with it,
 *        not packed, no box: weight and box unknown.
 *   O6 returned (V), O7 cancelled (Z), O8 a test entrant's (T), O9 paid before the window (X): never counted.
 *   A claim decided REFUSED in Jul 2026 on an ORBIT from elsewhere (no order sold it).
 *
 * ── seedMarginVault: ONE QUEUE's house (lot Q2's add-ons, lot Q3's VAULT; D61) ───────────────────────────────────────
 *
 * Settings: no rate (CHF has none); bands FR up to 1 000 g € 6.90; POUCH € 3.00, CARD € 2.00, VAULT_CARD € 0.50; J at
 * 2.5 %. Box BX € 2.50, 100 g; HALO (J) packs in it at 150 g, NOVA (J, never priced by a supplier) too. THE VAULT's
 * PIECE source on (the migration's default): a box of a piece bought holds THE VAULT CARD.
 * Supplier prices: SO1 (EUR, € 30.00 shipping over 30 units: € 1.00 a unit) HALO 52 (A) 10 at € 200, POLISHING CLOTH
 * (a PRODUCT add-on, the release add-on converted into the catalogue's) 20 at € 5. GIFT WRAPPING is a SERVICE.
 * Every vault is the house's (GIVE A VAULT), given 1 May 2026 and opened mid-month; the table holds one row per reward.
 *
 *   O0   A, SALON HALO A traced, FR, paid 15 Mar 2026 (before lot Q2): € 1 000 + the release's POLISHING CLOTH € 15
 *        (`orders.addons`) + its engraving € 40 (`engraving_minor`): revenue only. Packed in BX at 400 g before lot Q3: no
 *        card line.
 *   O1   A, SALON HALO A traced, FR, paid 15 May 2026: € 1 000, GIFT WRAPPING € 5 (a SERVICE unit), POLISHING CLOTH € 20
 *        (a PRODUCT unit bought), the vault vA's free POLISHING CLOTH (a unit of source VAULT at 0), € 15 shipping, less
 *        vC's house credit € 25 (CREDIT · VAULT). Packed in BX at 400 g, its checklist holding THE VAULT CARD.
 *   O2   F, SALON HALO A not bound, FR, paid 20 May 2026: € 800 + € 15 shipping less F's birthday credit € 20 and the
 *        € 30 credit G's vault vG gave F for a first piece (accepted 12 May): CREDIT · BIRTHDAY and CREDIT · VAULT. Not
 *        packed: BX + 150 g = 250 g, and THE VAULT CARD by the rule (estimates).
 *   OW   W (TITANE: one piece since January), vP's HALO won FREE: a VAULT order at 0 claimed (PAID) 15 Jun 2026, traced,
 *        packed in BX at 400 g FR.
 *   OR   W, vR's HALO under its RIGHT TO BUY: a VAULT order at € 900 + € 15 shipping, paid 11 Jul 2026, not bound, not
 *        packed (its card by the rule).
 *   OX   U, vX's HALO won free, not claimed: CANCELLED at its claim_by. ON: U, vN's NOVA won free (5 Oct 2026), RESERVED.
 *   K    vGu's guarantee (a piece at the next LIVE release), used 1 Jun 2026 at a LIVE release.
 *   vChf A's house credit of CHF 10, opened 10 May 2026, never used (CHF has no rate).
 *   T    a test entrant: vTp's HALO won free (OT, claimed 15 Jun, not packed), vTc's € 25 credit and vTa's free CLOTH on
 *        its SALON order OTs (€ 1 000, paid 20 Jun, not packed), vTg's guarantee used 1 Jun.
 *
 * ── seedMarginEdges: the first plan's cases a figure divisible by two would hide ─────────────────────────────────────
 *
 * Settings: bands FR up to 1 000 g € 10.00, ALL OTHER COUNTRIES up to 1 000 g € 15.00; POUCH € 3.00, CARD € 2.00; J at
 * 2.5 %. Box BX € 2.50, 100 g. THE VAULT's PIECE source off (no card in these boxes).
 * Supplier prices: SO1 (EUR, € 12.00 shipping) HALO 52 (A) 10 at € 200, 9 accepted and 1 rejected that the supplier
 * credited; NOVA 52 (N) 4 at € 300, 3 accepted and 1 cancelled: 12 units it brings, € 1.00 inbound a unit (over 13 or
 * 14 it would not be whole). A's average: € 200 and € 1.00.
 *
 *   O1   E, SALON HALO A traced, FR, paid 1 Apr 2026: € 1 000 + the catalogue's ENGRAVING (a SERVICE unit, the converted
 *        engraving) € 40. O2 (E, LIVE HALO A traced, paid 2 Apr) and O3 (E, DRAW HALO A not bound, paid 3 Apr), € 1 000
 *        each, travel with it: one parcel of three paid orders in BX at 600 g, FR: BX 84 / 83 / 83 cents, the band
 *        334 / 333 / 333, first order first.
 *   O4   H (TITANE: one piece since January), SALON NOVA N traced, FR, paid 1 May 2026: € 1 500, packed in BX at 1 200 g,
 *        heavier than every band of FR and of ALL OTHER COUNTRIES: no OUTBOUND, a rate missing.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { Db } from '../../src/server/db/connection.js';
import { jsonText, type OrderChannel, type OrderStatus, type VaultRewardKind } from '../../src/server/db/schema.js';
import { GrowthWorld } from './growth.js';

/** The clock of every reading of the fixture. */
export const MARGIN_NOW = new Date('2026-10-15T12:00:00.000Z');

const at = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00.000Z` : iso);
const DAY = 86_400_000;

export interface Line {
  kind: string;
  label: string;
  detail: string | null;
  amountMinor: number;
}

export class MarginWorld {
  readonly g: GrowthWorld;
  private seq = 0;
  private rewardPosition = 0;
  supplier = '';

  constructor(
    readonly db: Db,
    readonly adminId: string,
  ) {
    this.g = new GrowthWorld(db);
  }

  async prepare(): Promise<this> {
    await this.g.prepare();
    const s = await this.db.selectFrom('invoices').select((eb) => eb.fn.max('sequence').as('s')).executeTakeFirst();
    this.seq = Number(s?.s ?? 0);
    this.supplier = (await this.db.insertInto('suppliers').values({ name: `Margin ${randomUUID().slice(0, 8)}` }).returning('id').executeTakeFirstOrThrow()).id;
    return this;
  }

  get location(): string {
    return this.g.location;
  }

  async category(id: number, code: string, name: string): Promise<void> {
    await this.db.insertInto('categories').values({ id, code, name }).onConflict((oc) => oc.doNothing()).execute();
  }

  async model(name: string, o: { categoryId?: number; variantOf?: string; label?: string; boxId?: string; packedWeightG?: number } = {}): Promise<string> {
    return (
      await this.db
        .insertInto('models')
        .values({
          category_id: o.categoryId ?? 1,
          name,
          type: 'RING',
          sku_prefix: `${name.slice(0, 3)}-${randomUUID().slice(0, 8)}`,
          variant_of: o.variantOf ?? null,
          variant_label: o.label ?? null,
          variant_swatch: o.label ? '#C9A55C' : null,
          box_id: o.boxId ?? null,
          packed_weight_g: o.packedWeightG ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  async sku(modelId: string, label: string | null): Promise<string> {
    return (await this.db.insertInto('skus').values({ model_id: modelId, size_label: label, code: `M-${randomUUID().slice(0, 12)}` }).returning('id').executeTakeFirstOrThrow()).id;
  }

  /** A catalogue add-on and its SKU: a PRODUCT, or (lot Q2) a SERVICE (no supplier, no stock), the engraving among them. */
  async addon(name: string, o: { kind?: 'PRODUCT' | 'SERVICE'; weightG?: number; engraving?: boolean } = {}): Promise<{ id: string; skuId: string }> {
    const id = (await this.db.insertInto('addon_items').values({ name, kind: o.kind ?? 'PRODUCT', weight_g: o.weightG ?? null, engraving: o.engraving ?? false }).returning('id').executeTakeFirstOrThrow()).id;
    const skuId = (await this.db.insertInto('skus').values({ addon_id: id, size_label: null, code: `A-${randomUUID().slice(0, 12)}` }).returning('id').executeTakeFirstOrThrow()).id;
    return { id, skuId };
  }

  async box(name: string, costMinor: number | null, emptyWeightG = 100): Promise<string> {
    return (
      await this.db
        .insertInto('boxes')
        .values({ name, inside_length_mm: 120, inside_width_mm: 80, inside_height_mm: 40, empty_weight_g: emptyWeightG, cost_minor: costMinor, currency: costMinor === null ? null : 'EUR' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  /**
   * A supplier order sent (and its reception confirmed when some pieces were accepted): its lines, each with its
   * quantity, price, pieces accepted, those rejected and credited by the supplier instead of replaced, and those
   * cancelled; returns each SKU's reception line (to trace pieces to).
   */
  async supplierOrder(o: { currency: string; shippingMinor: number | null; sent: string; lines: { skuId: string; quantity: number; priceMinor: number; accepted: number; restCancelled?: number; credited?: number }[] }): Promise<Map<string, string>> {
    const sent = at(o.sent);
    const so = (
      await this.db
        .insertInto('supplier_orders')
        .values({ supplier_id: this.supplier, location_id: this.location, status: 'SENT', currency: o.currency, shipping_minor: o.shippingMinor, expected_on: o.sent, sent_at: sent })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const reception = (
      await this.db.insertInto('receptions').values({ supplier_order_id: so, location_id: this.location, status: 'CONFIRMED', counted_at: sent, confirmed_at: sent }).returning('id').executeTakeFirstOrThrow()
    ).id;
    const out = new Map<string, string>();
    for (const l of o.lines) {
      const line = (
        await this.db
          .insertInto('supplier_order_lines')
          .values({
            supplier_order_id: so,
            sku_id: l.skuId,
            quantity: l.quantity,
            unit_price_minor: l.priceMinor,
            accepted_quantity: l.accepted,
            rejected_quantity: l.credited ?? 0,
            credited_quantity: l.credited ?? 0,
            rest_cancelled_quantity: l.restCancelled ?? 0,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      if (l.accepted > 0) {
        const rl = (
          await this.db.insertInto('reception_lines').values({ reception_id: reception, sku_id: l.skuId, supplier_order_line_id: line, accepted: l.accepted, rejected: l.credited ?? 0 }).returning('id').executeTakeFirstOrThrow()
        ).id;
        out.set(l.skuId, rl);
      }
    }
    return out;
  }

  /** A piece of `modelId` in `skuId`, traced to a reception line when given. */
  async piece(modelId: string, skuId: string | null, receptionLineId: string | null = null): Promise<string> {
    const id = await this.g.piece(modelId);
    await this.db.updateTable('products').set({ sku_id: skuId, reception_line_id: receptionLineId }).where('id', '=', id).execute();
    return id;
  }

  /**
   * An order paid at `paid`, its invoice issued then with `lines` (none for a GIFT); RETURNED (shipped the next day) or
   * CANCELLED with its credit note at `ended`.
   */
  async order(o: {
    accountId: string;
    modelId: string;
    channel: OrderChannel;
    paid: string;
    currency: string;
    lines?: Line[];
    status?: OrderStatus;
    ended?: string;
    dropId?: string;
    dropEntryId?: string;
    liveEntryId?: string;
    piece?: number;
    withOrderId?: string;
    giftGrantId?: string;
    exchangeOf?: string;
    skuId?: string | null;
    productId?: string | null;
    country?: string | null;
    shipping?: { service: 'STANDARD' | 'EXPRESS'; minor: number; benefit?: 2 | 3 };
    setSaleId?: string;
    setPiece?: number;
    /** THE VAULT (lot Q3): a VAULT order's vault, and a VAULT order at 0's 30 days to be claimed. */
    vaultId?: string;
    claimBy?: string;
    /** Never paid (RESERVED, or CANCELLED unclaimed): no paid time, no invoice. */
    unpaid?: boolean;
    /** Before lot Q2: the release's add-ons (`orders.addons`) and the settings' engraving, as history. */
    addons?: { label: string; priceMinor: number }[];
    engraving?: { text: string; minor: number };
  }): Promise<string> {
    const paid = at(o.paid);
    const status = o.status ?? (o.unpaid ? 'RESERVED' : 'PAID');
    const ended = o.ended ? at(o.ended) : null;
    const shopRequest =
      o.channel === 'SALON'
        ? (
            await this.db
              .insertInto('shop_requests')
              .values({ account_id: o.accountId, model_id: o.modelId, status: 'CLOSED', created_at: new Date(paid.getTime() - DAY), handled_at: new Date(paid.getTime() - 3_600_000), outcome: 'ACCEPTED' })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id
        : null;
    const lines = o.lines ?? [];
    const total = lines.reduce((n, l) => n + l.amountMinor, 0);
    const shipped = status === 'RETURNED' ? new Date(paid.getTime() + DAY) : null;
    const id = (
      await this.db
        .insertInto('orders')
        .values({
          channel: o.channel,
          account_id: o.accountId,
          model_id: o.modelId,
          shop_request_id: shopRequest,
          drop_id: o.dropId ?? null,
          drop_entry_id: o.dropEntryId ?? null,
          live_entry_id: o.liveEntryId ?? null,
          piece: o.piece ?? 1,
          with_order_id: o.withOrderId ?? null,
          gift_grant_id: o.giftGrantId ?? null,
          exchange_of_order_id: o.exchangeOf ?? null,
          set_sale_id: o.setSaleId ?? null,
          set_piece: o.setSaleId ? (o.setPiece ?? 1) : null,
          sku_id: o.skuId ?? null,
          price_minor: o.channel === 'GIFT' ? 0 : total,
          currency: o.currency,
          status,
          reserved_at: new Date(paid.getTime() - 3_600_000),
          paid_at: o.unpaid ? null : paid,
          reservation: status === 'RESERVED' ? 'STOCK' : null,
          vault_id: o.vaultId ?? null,
          claim_by: o.claimBy ? at(o.claimBy) : null,
          addons: jsonText((o.addons ?? []).map((a) => ({ id: randomUUID(), ...a }))),
          engraving_text: o.engraving?.text ?? null,
          engraving_minor: o.engraving?.minor ?? null,
          engraving_by: o.engraving ? 'STAFF' : null,
          shipped_at: shipped,
          carrier_id: shipped ? this.g.carrier : null,
          tracking_number: shipped ? 'MARGIN-123' : null,
          returned_at: status === 'RETURNED' ? ended : null,
          cancelled_at: status === 'CANCELLED' ? ended : null,
          location_id: this.location,
          product_id: o.productId ?? null,
          buyer_country: o.withOrderId ? null : (o.country ?? null),
          shipping_service: o.shipping?.service ?? null,
          shipping_minor: o.shipping?.minor ?? null,
          shipping_benefit: o.shipping?.benefit ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    if (o.channel === 'GIFT' || o.unpaid) return id;
    const invoice = await this.invoice(id, { kind: 'INVOICE', issued: paid, currency: o.currency, lines });
    if (ended) await this.invoice(id, { kind: 'CREDIT_NOTE', issued: ended, currency: o.currency, lines, credits: invoice, scope: 'FULL' });
    return id;
  }

  /** An invoice or a credit note of an order, its total the sum of its lines. */
  async invoice(orderId: string, d: { kind: 'INVOICE' | 'CREDIT_NOTE'; issued: Date | string; currency: string; lines: Line[]; credits?: string; supplements?: string; scope?: 'FULL' | 'LINES' }): Promise<string> {
    const issued = typeof d.issued === 'string' ? at(d.issued) : d.issued;
    const total = d.lines.reduce((n, l) => n + l.amountMinor, 0);
    return (
      await this.db
        .insertInto('invoices')
        .values({
          kind: d.kind,
          year: issued.getUTCFullYear(),
          sequence: ++this.seq,
          order_id: orderId,
          credits_invoice_id: d.credits ?? null,
          supplements_invoice_id: d.supplements ?? null,
          credit_scope: d.kind === 'CREDIT_NOTE' ? (d.scope ?? 'FULL') : null,
          issuer: jsonText({ name: 'CONGLOMERAT LLC', address: ['30 N Gould St, Ste N', 'Sheridan, WY 82801', 'United States'] }),
          buyer: jsonText({ name: null, address: null, email: null }),
          lines: jsonText(d.lines),
          currency: d.currency,
          subtotal_minor: total,
          total_minor: total,
          issued_at: issued,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  /** A parcel's shipment: PACKED (or LOST, shipped the same day) at `packed`, its box, weight and pieces bound. */
  async shipment(key: string, o: { packed: string; boxId: string | null; weightG: number | null; status?: 'PACKED' | 'LOST'; items: { orderId: string; productId: string | null }[]; checklist?: { key: string; label: string }[] }): Promise<string> {
    const packed = at(o.packed);
    const lost = o.status === 'LOST';
    const id = (
      await this.db
        .insertInto('shipments')
        .values({
          order_id: key,
          location_id: this.location,
          status: o.status ?? 'PACKED',
          packing_started_at: packed,
          packed_at: packed,
          box_id: o.boxId,
          weight_g: o.weightG,
          weight_missing: o.weightG === null ? ['box'] : null,
          ...(o.checklist ? { checklist: jsonText(o.checklist) } : {}),
          shipped_at: lost ? packed : null,
          carrier_id: lost ? this.g.carrier : null,
          tracking_number: lost ? 'MARGIN-LOST' : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    for (const i of o.items) await this.db.insertInto('shipment_items').values({ shipment_id: id, order_id: i.orderId, product_id: i.productId, scanned_at: i.productId ? packed : null }).execute();
    return id;
  }

  /** A parcel lost, decided RESHIP: its pieces revoked. */
  async lostCase(orderId: string, shipmentId: string, decided: string): Promise<void> {
    const d = at(decided);
    await this.db
      .insertInto('order_cases')
      .values({ order_id: orderId, shipment_id: shipmentId, kind: 'LOST', opened_by_type: 'admin', opened_by_id: this.adminId, opened_at: d, status: 'CLOSED', outcome: 'RESHIP', piece_to: 'REVOKED', closed_at: d })
      .execute();
  }

  /** An order's return (its piece back to stock, or to the archive). */
  async returned(orderId: string, outcome: 'RESTOCKED' | 'ARCHIVED', when: string): Promise<void> {
    await this.db.insertInto('returns').values({ order_id: orderId, outcome, location_id: outcome === 'RESTOCKED' ? this.location : null, note: 'Size exchange.', created_at: at(when) }).execute();
  }

  /** A PRIVATE CARE request DONE at `done` on the piece. */
  async care(accountId: string, productId: string, done: string): Promise<void> {
    const d = at(done);
    const t = (days: number) => new Date(d.getTime() - days * DAY);
    const record = (await this.db.insertInto('service_records').values({ product_id: productId, type: 'YEARLY_CARE', status: 'COMPLETED', opened_at: t(5), closed_at: t(2) }).returning('id').executeTakeFirstOrThrow()).id;
    await this.db
      .insertInto('care_requests')
      .values({
        account_id: accountId,
        product_id: productId,
        year: d.getUTCFullYear(),
        tier: 2,
        status: 'DONE',
        requested_at: t(10),
        return_name: 'Care return',
        return_address: '1 rue de la Paix, Paris',
        label_carrier_id: this.g.carrier,
        label_tracking: 'LABEL-1',
        label_at: t(9),
        service_record_id: record,
        received_at: t(5),
        return_carrier_id: this.g.carrier,
        return_tracking: 'RETURN-1',
        return_shipped_at: t(1),
        done_at: d,
      })
      .execute();
  }

  /** A legal claim of a buyer without an account, decided REFUSED (no fault found) at `decided`. */
  async refusedClaim(productId: string, decided: string): Promise<void> {
    const d = at(decided);
    await this.db
      .insertInto('warranty_claims')
      .values({
        product_id: productId,
        root_product_id: productId,
        basis: 'LEGAL',
        status: 'DONE',
        opened_at: new Date(d.getTime() - DAY),
        opened_by: this.adminId,
        outcome: 'REFUSED',
        refusal_reason: 'NO_FAULT_FOUND',
        decided_at: d,
        decided_by: this.adminId,
        done_at: d,
        note: 'Receipt shown in the boutique.',
      })
      .execute();
  }
  // ── THE VAULT (lot Q3), written as the opening leaves it ──────────────────

  /** A row of THE VAULT's table. */
  async reward(kind: VaultRewardKind, o: { amountMinor?: number; currency?: string; modelId?: string; addonId?: string; mode?: 'FREE' | 'RIGHT_TO_BUY' } = {}): Promise<string> {
    return (
      await this.db
        .insertInto('vault_rewards')
        .values({
          kind,
          odds_in: 100,
          quantity: 100,
          amount_minor: o.amountMinor ?? null,
          currency: o.currency ?? null,
          model_id: o.modelId ?? null,
          addon_id: o.addonId ?? null,
          mode: o.mode ?? null,
          position: ++this.rewardPosition,
          created_by: this.adminId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  /**
   * A vault the house gave on `given` (GIVE A VAULT), opened on `opened` with its reward: its prize, value and cost as
   * the opening writes them (a credit's face value its cost; a product's cost read at the report), and its offer.
   */
  async vault(accountId: string, o: { given: string; opened: string; rewardId: string; kind: VaultRewardKind; value?: [number, string]; cost?: number; offerUntil?: string; offerUsed?: string }): Promise<string> {
    const given = at(o.given);
    return (
      await this.db
        .insertInto('vaults')
        .values({
          account_id: accountId,
          source: 'HOUSE',
          given_by: this.adminId,
          occasion_key: `HOUSE:${randomUUID()}`,
          occasion_index: 1,
          given_at: given,
          waits_until: new Date(given.getTime() + 30 * DAY),
          opened_at: at(o.opened),
          reward_id: o.rewardId,
          reward_kind: o.kind,
          prize: o.kind.replace(/_/g, ' '),
          odds_text: '1 IN 100',
          rare: o.kind === 'GUARANTEED',
          value_minor: o.value?.[0] ?? null,
          currency: o.value?.[1] ?? null,
          cost_minor: o.cost ?? null,
          offer_until: o.offerUntil ? at(o.offerUntil) : null,
          offer_used_at: o.offerUsed ? at(o.offerUsed) : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  /** What a vault gave, linked once (its credit, its order, its guarantee or its credit to give). */
  async link(vaultId: string, l: { grant_id?: string; order_id?: string; guarantee_id?: string; gift_id?: string }): Promise<void> {
    await this.db.updateTable('vaults').set(l).where('id', '=', vaultId).execute();
  }

  /** A VAULT credit for 30 days from `granted`: a house credit won, or a friend's credit for a first piece. */
  async vaultGrant(accountId: string, vaultId: string, amountMinor: number, currency: string, granted: string, forAFirstPiece = false): Promise<string> {
    const g = at(granted);
    return (
      await this.db
        .insertInto('tier_grants')
        .values({ account_id: accountId, tier: null, kind: 'VAULT', granted_at: g, amount_minor: amountMinor, currency, expires_at: new Date(g.getTime() + 30 * DAY), vault_id: vaultId, usable_while_no_piece: forAFirstPiece })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  /** A birthday credit (a PERK). */
  async birthdayGrant(accountId: string, amountMinor: number, day: string): Promise<string> {
    const g = at(day);
    return (
      await this.db
        .insertInto('tier_grants')
        .values({ account_id: accountId, tier: null, kind: 'BIRTHDAY', granted_at: g, amount_minor: amountMinor, currency: 'EUR', expires_at: new Date(g.getTime() + 30 * DAY), birthday_on: day })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  /** A credit taken off an order (Apply credit). */
  async creditUse(grantId: string, orderId: string, amountMinor: number, applied: string): Promise<void> {
    await this.db.insertInto('credit_uses').values({ grant_id: grantId, order_id: orderId, amount_minor: amountMinor, applied_by: this.adminId, applied_at: at(applied) }).execute();
  }

  /** A credit to give (CREDIT TO GIVE), created at the opening and accepted by `friend` with its VAULT grant. */
  async creditToGive(vaultId: string, amountMinor: number, created: string, friend: string, accepted: string, grantId: string): Promise<string> {
    const c = at(created);
    return (
      await this.db
        .insertInto('vault_gifts')
        .values({ vault_id: vaultId, code_hash: new Uint8Array(randomBytes(32)), amount_minor: amountMinor, currency: 'EUR', created_at: c, expires_at: new Date(c.getTime() + 30 * DAY), accepted_by: friend, accepted_at: at(accepted), grant_id: grantId })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  /** A unit of a catalogue add-on on an order, HELD: bought (PURCHASE) at its price, or the vault's free one (VAULT, at 0). */
  async unit(orderId: string, addon: { id: string; skuId: string }, o: { priceMinor: number; added: string; service?: boolean; vaultId?: string }): Promise<void> {
    await this.db
      .insertInto('order_addon_items')
      .values({
        order_id: orderId,
        addon_id: addon.id,
        sku_id: addon.skuId,
        location_id: o.service ? null : this.location,
        price_minor: o.priceMinor,
        currency: 'EUR',
        status: 'HELD',
        added_at: at(o.added),
        added_by_type: o.vaultId ? 'VAULT' : 'PURCHASE',
        vault_id: o.vaultId ?? null,
      })
      .execute();
  }

  /** A vault's guarantee (a piece at the next LIVE release), used at `dropId` on `used`. */
  async usedGuarantee(accountId: string, vaultId: string, granted: string, used: string, dropId: string): Promise<string> {
    const g = at(granted);
    const u = at(used);
    return (
      await this.db
        .insertInto('house_guarantees')
        .values({ account_id: accountId, scope: 'LIVE', vault_id: vaultId, pieces: 1, valid_until: new Date(g.getTime() + 90 * DAY), visible: true, status: 'USED', used_at: u, used_drop_id: dropId, closed_at: u, closed_reason: 'USED', granted_by: null, granted_at: g })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }
}

export interface MarginFixture {
  world: MarginWorld;
  accounts: Record<'X' | 'Y' | 'Z' | 'V' | 'W' | 'T', string>;
  models: { halo: string; gold: string; aura: string; orbit: string };
  categories: { J: number; Q: number };
  orders: Record<'O1' | 'O2' | 'O3' | 'O4' | 'O5' | 'E5' | 'O10' | 'S1' | 'S2' | 'O6' | 'O7' | 'O8' | 'O9' | 'G1', string>;
  releases: { live: string; live2: string; draw: string; setDraw: string };
  box: string;
}

const piece = (amount: number, detail = 'THE PRIVATE SALON'): Line => ({ kind: 'PIECE', label: 'HALO · SIZE 52', detail, amountMinor: amount });

/** The house described in the file header, with its settings entered as rows (as Margin settings writes them). */
export async function seedMargin(db: Db, adminId: string): Promise<MarginFixture> {
  const w = await new MarginWorld(db, adminId).prepare();
  const J = 1;
  const Q = 17;
  await w.category(Q, 'Q', 'Leather goods');

  // The house before THE VAULT: no box holds THE VAULT CARD.
  await db.updateTable('vault_sources').set({ enabled: false }).where('source', '=', 'PIECE').execute();

  // Settings.
  await db.insertInto('currency_rates').values({ currency: 'GBP', eur_rate: '1.2' }).execute();
  await db
    .insertInto('shipping_cost_rates')
    .values([
      { country: 'FR', max_weight_g: 500, cost_minor: 690, currency: 'EUR' },
      { country: 'FR', max_weight_g: 1000, cost_minor: 990, currency: 'EUR' },
      { country: null, max_weight_g: 1000, cost_minor: 1500, currency: 'EUR' },
    ])
    .execute();
  await db
    .insertInto('margin_unit_costs')
    .values([
      { key: 'POUCH', cost_minor: 300, currency: 'EUR' },
      { key: 'CARD', cost_minor: 200, currency: 'EUR' },
      { key: 'CARE_SERVICE', cost_minor: 5000, currency: 'EUR' },
      { key: 'CLAIM_REFUSED', cost_minor: 1000, currency: 'EUR' },
    ])
    .execute();
  await db.insertInto('category_allowances').values({ category_id: J, allowance_bp: 250 }).execute();

  // Catalogue and supplier prices.
  const box = await w.box('BX', 250);
  const halo = await w.model('HALO', { label: 'Steel', boxId: box, packedWeightG: 150 });
  const gold = await w.model('HALO', { variantOf: halo, label: 'Gold' });
  const aura = await w.model('AURA', { categoryId: Q });
  const orbit = await w.model('ORBIT');
  const A = await w.sku(halo, '52');
  const B = await w.sku(halo, '54');
  const goldA = await w.sku(gold, '52');
  const auraSku = await w.sku(aura, null);
  const orbitSku = await w.sku(orbit, null);
  const charm = await w.addon('CHARM');
  const so1 = await w.supplierOrder({
    currency: 'EUR',
    shippingMinor: 1500,
    sent: '2026-01-05',
    lines: [
      { skuId: A, quantity: 10, priceMinor: 20_000, accepted: 10 },
      { skuId: B, quantity: 6, priceMinor: 30_000, accepted: 5, restCancelled: 1 },
    ],
  });
  await w.supplierOrder({ currency: 'GBP', shippingMinor: null, sent: '2026-02-05', lines: [{ skuId: A, quantity: 10, priceMinor: 15_000, accepted: 10 }] });
  await w.supplierOrder({ currency: 'EUR', shippingMinor: 0, sent: '2026-01-06', lines: [{ skuId: charm.skuId, quantity: 20, priceMinor: 1_500, accepted: 20 }] });
  await w.supplierOrder({ currency: 'CHF', shippingMinor: 0, sent: '2026-01-07', lines: [{ skuId: orbitSku, quantity: 5, priceMinor: 10_000, accepted: 5 }] });
  const tracedA = () => w.piece(halo, A, so1.get(A)!);
  const tracedB = () => w.piece(halo, B, so1.get(B)!);

  // Accounts and what they held.
  const X = await w.g.account('2025-12-01', 'FR');
  const Y = await w.g.account('2025-12-01', 'DE');
  const Z = await w.g.account('2025-12-01', 'GB');
  const V = await w.g.account('2025-12-01', 'FR');
  const W = await w.g.account('2025-12-01', 'FR');
  const T = await w.g.account('2025-12-01', 'FR');
  await db.insertInto('test_entrants').values({ account_id: T }).execute();
  await w.g.own(X, await w.g.piece(orbit), 'FIRST_REGISTRATION', '2026-01-01');
  for (let i = 0; i < 5; i++) await w.g.own(X, await w.g.piece(orbit), 'ADMIN', '2026-05-01');
  for (let i = 0; i < 10; i++) await w.g.own(Y, await w.g.piece(orbit), 'ADMIN', '2026-01-01');

  // O1: a salon order, its add-on unit, its welcome gift; one parcel packed.
  const p1 = await tracedA();
  const O1 = await w.order({
    accountId: X,
    modelId: halo,
    channel: 'SALON',
    paid: '2026-03-01',
    currency: 'EUR',
    skuId: A,
    productId: p1,
    country: 'FR',
    shipping: { service: 'STANDARD', minor: 1500 },
    lines: [piece(120_000), { kind: 'ADD_ON_ITEM', label: 'CHARM', detail: null, amountMinor: 2_500 }, { kind: 'SHIPPING', label: 'SHIPPING · STANDARD', detail: null, amountMinor: 1_500 }, { kind: 'GIFT', label: 'WELCOME GIFT · HALO', detail: null, amountMinor: 0 }],
  });
  await db
    .insertInto('order_addon_items')
    .values({ order_id: O1, addon_id: charm.id, sku_id: charm.skuId, location_id: w.location, price_minor: 2_500, currency: 'EUR', status: 'HELD', added_at: at('2026-03-01'), added_by_type: 'PURCHASE' })
    .execute();
  const grant = await w.g.giftGrant(X, halo, '2026-02-28');
  const pg = await tracedB();
  const G1 = await w.order({ accountId: X, modelId: halo, channel: 'GIFT', paid: '2026-03-01', currency: 'EUR', withOrderId: O1, giftGrantId: grant, skuId: B, productId: pg });
  await w.shipment(O1, { packed: '2026-03-03', boxId: box, weightG: 400, items: [{ orderId: O1, productId: p1 }, { orderId: G1, productId: pg }] });
  await w.care(X, p1, '2026-06-01');

  // O2 and O3: two LIVE pieces in one parcel, free shipping, a credit, a supplementary invoice and a line credited.
  const live = await w.g.drop({ mode: 'LIVE', modelId: halo, title: 'HALO — LIVE', opens: '2026-04-01', quantity: 5 });
  const live2 = await w.g.drop({ mode: 'LIVE', modelId: halo, title: 'HALO — LIVE II', opens: '2026-04-02', quantity: 5 });
  const p2 = await tracedA();
  const O2 = await w.order({
    accountId: Y,
    modelId: halo,
    channel: 'LIVE',
    paid: '2026-04-01',
    currency: 'EUR',
    dropId: live.id,
    liveEntryId: await w.g.liveEntry(live, Y, '2026-04-01'),
    skuId: A,
    productId: p2,
    country: 'DE',
    shipping: { service: 'EXPRESS', minor: 0, benefit: 3 },
    lines: [piece(120_000, 'LIVE RELEASE'), { kind: 'SHIPPING', label: 'SHIPPING · EXPRESS', detail: 'FREE · PALLADIUM', amountMinor: 0 }, { kind: 'CREDIT', label: 'CREDIT · PALLADIUM', detail: null, amountMinor: -10_000 }],
  });
  const main2 = (await db.selectFrom('invoices').select('id').where('order_id', '=', O2).executeTakeFirstOrThrow()).id;
  const addonLine: Line = { kind: 'ADD_ON_ITEM', label: 'CHARM', detail: null, amountMinor: 2_000 };
  const supp = await w.invoice(O2, { kind: 'INVOICE', issued: '2026-04-05', currency: 'EUR', supplements: main2, lines: [{ kind: 'ENGRAVING', label: 'Engraving', detail: null, amountMinor: 5_000 }, addonLine] });
  await w.invoice(O2, { kind: 'CREDIT_NOTE', issued: '2026-04-06', currency: 'EUR', credits: supp, scope: 'LINES', lines: [addonLine] });
  const O3 = await w.order({
    accountId: Y,
    modelId: halo,
    channel: 'LIVE',
    paid: '2026-04-02',
    currency: 'EUR',
    dropId: live2.id,
    liveEntryId: await w.g.liveEntry(live2, Y, '2026-04-02'),
    withOrderId: O2,
    skuId: A,
    lines: [piece(120_000, 'LIVE RELEASE')],
  });
  await w.shipment(O2, { packed: '2026-04-04', boxId: box, weightG: 900, items: [{ orderId: O2, productId: p2 }, { orderId: O3, productId: null }] });

  // O4: a draw in pounds, paid, not packed.
  const draw = await w.g.drop({ mode: 'DRAW', modelId: halo, title: 'HALO — DRAW', opens: '2026-05-01', quantity: 5 });
  const O4 = await w.order({ accountId: Z, modelId: halo, channel: 'DRAW', paid: '2026-05-10', currency: 'GBP', dropId: draw.id, dropEntryId: await w.g.drawEntry(draw.id, Z, 'CONFIRMED', '2026-04-30'), skuId: A, country: 'GB', lines: [piece(100_000, 'DRAW')] });

  // O5 and E5: a size exchange.
  const p5 = await tracedA();
  const O5 = await w.order({ accountId: V, modelId: halo, channel: 'SALON', paid: '2026-06-01', currency: 'EUR', skuId: A, productId: p5, country: 'FR', status: 'RETURNED', ended: '2026-06-10', lines: [piece(120_000)] });
  await w.shipment(O5, { packed: '2026-06-01T15:00:00.000Z', boxId: box, weightG: 400, items: [{ orderId: O5, productId: p5 }] });
  await w.returned(O5, 'RESTOCKED', '2026-06-10');
  const p6 = await tracedB();
  const E5 = await w.order({ accountId: V, modelId: halo, channel: 'EXCHANGE', paid: '2026-06-10', currency: 'EUR', exchangeOf: O5, skuId: B, productId: p6, country: 'FR', lines: [piece(120_000, 'SIZE EXCHANGE')] });
  await w.shipment(E5, { packed: '2026-06-11', boxId: box, weightG: 400, items: [{ orderId: E5, productId: p6 }] });

  // O10: a variant's parcel lost, reshipped with another piece.
  const p10 = await w.piece(gold, goldA, so1.get(A)!);
  const p11 = await w.piece(gold, goldA, so1.get(A)!);
  const O10 = await w.order({ accountId: V, modelId: gold, channel: 'SALON', paid: '2026-07-01', currency: 'EUR', skuId: goldA, productId: p11, country: 'FR', lines: [piece(120_000)] });
  const lostParcel = await w.shipment(O10, { packed: '2026-07-02', boxId: box, weightG: 400, status: 'LOST', items: [{ orderId: O10, productId: p10 }] });
  await w.lostCase(O10, lostParcel, '2026-07-10');
  await w.shipment(O10, { packed: '2026-07-12', boxId: box, weightG: 400, items: [{ orderId: O10, productId: p11 }] });

  // S1 and S2: a set's draw, not packed, no box, no weight.
  const set = (await db.insertInto('sets').values({ name: 'DUO', code: 'DUO-1' }).returning('id').executeTakeFirstOrThrow()).id;
  await db.insertInto('set_models').values([{ set_id: set, position: 1, model_id: aura }, { set_id: set, position: 2, model_id: orbit }]).execute();
  const setDraw = await w.g.drop({ mode: 'DRAW', setId: set, title: 'DUO — DRAW', opens: '2026-08-01', quantity: 5 });
  const sale = (await db.insertInto('set_sales').values({ set_id: set, drop_id: setDraw.id, account_id: W, price_minor: 100_000, currency: 'EUR' }).returning('id').executeTakeFirstOrThrow()).id;
  const entry = await w.g.drawEntry(setDraw.id, W, 'CONFIRMED', '2026-07-31');
  const S1 = await w.order({ accountId: W, modelId: aura, channel: 'DRAW', paid: '2026-08-05', currency: 'EUR', dropId: setDraw.id, dropEntryId: entry, piece: 1, setSaleId: sale, setPiece: 1, skuId: auraSku, country: 'FR', lines: [{ kind: 'PIECE', label: 'AURA', detail: 'DRAW', amountMinor: 60_000 }] });
  const S2 = await w.order({ accountId: W, modelId: orbit, channel: 'DRAW', paid: '2026-08-05', currency: 'EUR', dropId: setDraw.id, dropEntryId: entry, piece: 2, setSaleId: sale, setPiece: 2, withOrderId: S1, skuId: orbitSku, lines: [{ kind: 'PIECE', label: 'ORBIT', detail: 'DRAW', amountMinor: 40_000 }] });

  // Never counted.
  const O6 = await w.order({ accountId: V, modelId: halo, channel: 'SALON', paid: '2026-02-01', currency: 'EUR', status: 'RETURNED', ended: '2026-02-20', lines: [piece(120_000)] });
  const O7 = await w.order({ accountId: Z, modelId: halo, channel: 'SALON', paid: '2026-02-01', currency: 'EUR', status: 'CANCELLED', ended: '2026-02-02', lines: [piece(120_000)] });
  const O8 = await w.order({ accountId: T, modelId: halo, channel: 'SALON', paid: '2026-02-01', currency: 'EUR', skuId: A, country: 'FR', lines: [piece(120_000)] });
  const O9 = await w.order({ accountId: X, modelId: halo, channel: 'SALON', paid: '2025-09-01', currency: 'EUR', lines: [piece(120_000)] });

  // A claim on a piece from elsewhere.
  await w.refusedClaim(await w.g.piece(orbit), '2026-07-01');

  return {
    world: w,
    accounts: { X, Y, Z, V, W, T },
    models: { halo, gold, aura, orbit },
    categories: { J, Q },
    orders: { O1, O2, O3, O4, O5, E5, O10, S1, S2, O6, O7, O8, O9, G1 },
    releases: { live: live.id, live2: live2.id, draw: draw.id, setDraw: setDraw.id },
    box,
  };
}

export interface MarginVaultFixture {
  world: MarginWorld;
  accounts: Record<'A' | 'G' | 'F' | 'W' | 'U' | 'K' | 'T', string>;
  models: { halo: string; nova: string };
  orders: Record<'O0' | 'O1' | 'O2' | 'OW' | 'OR' | 'OX' | 'ON' | 'OT' | 'OTs', string>;
  vaults: Record<'vC' | 'vG' | 'vA' | 'vP' | 'vR' | 'vX' | 'vN' | 'vGu' | 'vChf' | 'vTp' | 'vTc' | 'vTa' | 'vTg', string>;
  releases: { live: string };
  box: string;
}

/** ONE QUEUE's house described in the file header (seedMarginVault), its settings entered as rows. */
export async function seedMarginVault(db: Db, adminId: string): Promise<MarginVaultFixture> {
  const w = await new MarginWorld(db, adminId).prepare();

  // Settings: no rate (CHF has none).
  await db.insertInto('shipping_cost_rates').values({ country: 'FR', max_weight_g: 1000, cost_minor: 690, currency: 'EUR' }).execute();
  await db
    .insertInto('margin_unit_costs')
    .values([
      { key: 'POUCH', cost_minor: 300, currency: 'EUR' },
      { key: 'CARD', cost_minor: 200, currency: 'EUR' },
      { key: 'VAULT_CARD', cost_minor: 50, currency: 'EUR' },
    ])
    .execute();
  await db.insertInto('category_allowances').values({ category_id: 1, allowance_bp: 250 }).execute();

  // Catalogue and supplier prices.
  const box = await w.box('BX', 250);
  const halo = await w.model('HALO', { boxId: box, packedWeightG: 150 });
  const nova = await w.model('NOVA', { boxId: box, packedWeightG: 150 });
  const A = await w.sku(halo, '52');
  const N = await w.sku(nova, '52');
  const cloth = await w.addon('POLISHING CLOTH', { weightG: 20 });
  const wrap = await w.addon('GIFT WRAPPING', { kind: 'SERVICE' });
  const so1 = await w.supplierOrder({
    currency: 'EUR',
    shippingMinor: 3_000,
    sent: '2026-01-05',
    lines: [
      { skuId: A, quantity: 10, priceMinor: 20_000, accepted: 10 },
      { skuId: cloth.skuId, quantity: 20, priceMinor: 500, accepted: 20 },
    ],
  });
  const traced = () => w.piece(halo, A, so1.get(A)!);
  const piece = (amount: number, detail = 'THE PRIVATE SALON'): Line => ({ kind: 'PIECE', label: 'HALO · SIZE 52', detail, amountMinor: amount });
  const shipping: Line = { kind: 'SHIPPING', label: 'SHIPPING · STANDARD', detail: null, amountMinor: 1_500 };
  const vaultCredit = (amount: number): Line => ({ kind: 'CREDIT', label: 'CREDIT · VAULT', detail: null, amountMinor: -amount });

  // The table: one row per reward.
  const rCredit = await w.reward('CREDIT', { amountMinor: 2_500, currency: 'EUR' });
  const rChf = await w.reward('CREDIT', { amountMinor: 1_000, currency: 'CHF' });
  const rGive = await w.reward('CREDIT_TO_GIVE', { amountMinor: 3_000, currency: 'EUR' });
  const rAddon = await w.reward('ADDON', { addonId: cloth.id });
  const rFree = await w.reward('PRODUCT', { modelId: halo, mode: 'FREE' });
  const rNova = await w.reward('PRODUCT', { modelId: nova, mode: 'FREE' });
  const rBuy = await w.reward('PRODUCT', { modelId: halo, mode: 'RIGHT_TO_BUY' });
  const rGuar = await w.reward('GUARANTEED');

  // Accounts.
  const acc = async () => w.g.account('2025-12-01', 'FR');
  const accounts = { A: await acc(), G: await acc(), F: await acc(), W: await acc(), U: await acc(), K: await acc(), T: await acc() };
  await db.insertInto('test_entrants').values({ account_id: accounts.T }).execute();
  await w.g.own(accounts.W, await w.g.piece(halo), 'FIRST_REGISTRATION', '2026-01-10');
  await w.g.own(accounts.G, await w.g.piece(halo), 'FIRST_REGISTRATION', '2026-01-10');

  // O0: before lot Q2, the release's add-on and the settings' engraving on the order, revenue only; packed before lot Q3.
  const p0 = await traced();
  const O0 = await w.order({
    accountId: accounts.A,
    modelId: halo,
    channel: 'SALON',
    paid: '2026-03-15',
    currency: 'EUR',
    skuId: A,
    productId: p0,
    country: 'FR',
    addons: [{ label: 'POLISHING CLOTH', priceMinor: 1_500 }],
    engraving: { text: 'A.M.', minor: 4_000 },
    lines: [piece(100_000), { kind: 'ADDON', label: 'POLISHING CLOTH', detail: null, amountMinor: 1_500 }, { kind: 'ENGRAVING', label: 'Engraving', detail: null, amountMinor: 4_000 }],
  });
  await w.shipment(O0, { packed: '2026-03-17', boxId: box, weightG: 400, items: [{ orderId: O0, productId: p0 }], checklist: [] });

  // vC (a house credit), vA (a free add-on), vChf (a credit in francs, never used).
  const vC = await w.vault(accounts.A, { given: '2026-05-01', opened: '2026-05-10', rewardId: rCredit, kind: 'CREDIT', value: [2_500, 'EUR'], cost: 2_500 });
  const gC = await w.vaultGrant(accounts.A, vC, 2_500, 'EUR', '2026-05-10');
  await w.link(vC, { grant_id: gC });
  const vA = await w.vault(accounts.A, { given: '2026-05-01', opened: '2026-05-10', rewardId: rAddon, kind: 'ADDON', offerUntil: '2026-06-09', offerUsed: '2026-05-15T10:00:00.000Z' });
  const vChf = await w.vault(accounts.A, { given: '2026-05-01', opened: '2026-05-10', rewardId: rChf, kind: 'CREDIT', value: [1_000, 'CHF'], cost: 1_000 });
  await w.link(vChf, { grant_id: await w.vaultGrant(accounts.A, vChf, 1_000, 'CHF', '2026-05-10') });

  // O1: a service unit, a product unit bought, the vault's free unit, the house credit; packed with THE VAULT CARD.
  const p1 = await traced();
  const O1 = await w.order({
    accountId: accounts.A,
    modelId: halo,
    channel: 'SALON',
    paid: '2026-05-15',
    currency: 'EUR',
    skuId: A,
    productId: p1,
    country: 'FR',
    shipping: { service: 'STANDARD', minor: 1_500 },
    lines: [
      piece(100_000),
      { kind: 'ADD_ON_ITEM', label: 'GIFT WRAPPING', detail: null, amountMinor: 500 },
      { kind: 'ADD_ON_ITEM', label: 'POLISHING CLOTH', detail: null, amountMinor: 2_000 },
      { kind: 'ADD_ON_ITEM', label: 'POLISHING CLOTH', detail: 'FROM THE VAULT', amountMinor: 0 },
      shipping,
      vaultCredit(2_500),
    ],
  });
  await w.unit(O1, wrap, { priceMinor: 500, added: '2026-05-15T10:00:00.000Z', service: true });
  await w.unit(O1, cloth, { priceMinor: 2_000, added: '2026-05-15T10:00:00.000Z' });
  await w.unit(O1, cloth, { priceMinor: 0, added: '2026-05-15T10:00:00.000Z', vaultId: vA });
  await w.creditUse(gC, O1, 2_500, '2026-05-15T11:00:00.000Z');
  await w.shipment(O1, {
    packed: '2026-05-17',
    boxId: box,
    weightG: 400,
    items: [{ orderId: O1, productId: p1 }],
    checklist: [
      { key: `card:${O1}`, label: 'The card, its claim code visible' },
      { key: `vault-card:${O1}`, label: 'THE VAULT CARD' },
      { key: 'box', label: 'The box: BX, and the pouch' },
    ],
  });

  // vG: G's credit to give, accepted by F (holding no piece) for a first piece; O2 uses it with F's birthday credit.
  const vG = await w.vault(accounts.G, { given: '2026-05-01', opened: '2026-05-10', rewardId: rGive, kind: 'CREDIT_TO_GIVE', value: [3_000, 'EUR'], cost: 3_000 });
  const gF = await w.vaultGrant(accounts.F, vG, 3_000, 'EUR', '2026-05-12', true);
  await w.link(vG, { gift_id: await w.creditToGive(vG, 3_000, '2026-05-10', accounts.F, '2026-05-12', gF) });
  const gB = await w.birthdayGrant(accounts.F, 2_000, '2026-05-18');
  const O2 = await w.order({
    accountId: accounts.F,
    modelId: halo,
    channel: 'SALON',
    paid: '2026-05-20',
    currency: 'EUR',
    skuId: A,
    country: 'FR',
    shipping: { service: 'STANDARD', minor: 1_500 },
    lines: [piece(80_000), shipping, { kind: 'CREDIT', label: 'CREDIT · BIRTHDAY', detail: null, amountMinor: -2_000 }, vaultCredit(3_000)],
  });
  await w.creditUse(gB, O2, 2_000, '2026-05-20T10:00:00.000Z');
  await w.creditUse(gF, O2, 3_000, '2026-05-20T10:00:00.000Z');

  // vP: a HALO won FREE, claimed (PAID at 0), packed. vX: one never claimed (CANCELLED). vN: a NOVA, waiting for its claim.
  const vP = await w.vault(accounts.W, { given: '2026-05-01', opened: '2026-06-10', rewardId: rFree, kind: 'PRODUCT', value: [120_000, 'EUR'] });
  const pW = await traced();
  const OW = await w.order({ accountId: accounts.W, modelId: halo, channel: 'VAULT', paid: '2026-06-15', currency: 'EUR', vaultId: vP, claimBy: '2026-07-10', skuId: A, productId: pW, country: 'FR', lines: [piece(0, 'THE VAULT')] });
  await w.link(vP, { order_id: OW });
  await w.shipment(OW, { packed: '2026-06-17', boxId: box, weightG: 400, items: [{ orderId: OW, productId: pW }], checklist: [] });
  const vX = await w.vault(accounts.U, { given: '2026-05-01', opened: '2026-06-10', rewardId: rFree, kind: 'PRODUCT', value: [120_000, 'EUR'] });
  const OX = await w.order({ accountId: accounts.U, modelId: halo, channel: 'VAULT', paid: '2026-06-10T13:00:00.000Z', unpaid: true, status: 'CANCELLED', ended: '2026-07-10T13:00:00.000Z', currency: 'EUR', vaultId: vX, claimBy: '2026-07-10', skuId: A, country: 'FR', lines: [] });
  await w.link(vX, { order_id: OX });
  const vN = await w.vault(accounts.U, { given: '2026-09-20', opened: '2026-10-05', rewardId: rNova, kind: 'PRODUCT', value: [90_000, 'EUR'] });
  const ON = await w.order({ accountId: accounts.U, modelId: nova, channel: 'VAULT', paid: '2026-10-05T13:00:00.000Z', unpaid: true, currency: 'EUR', vaultId: vN, claimBy: '2026-11-04', skuId: N, country: 'FR', lines: [] });
  await w.link(vN, { order_id: ON });

  // vR: a HALO under its RIGHT TO BUY, bought at its price: a VAULT order like any sale, not packed.
  const vR = await w.vault(accounts.W, { given: '2026-05-01', opened: '2026-07-10', rewardId: rBuy, kind: 'PRODUCT', value: [90_000, 'EUR'], offerUntil: '2026-07-11', offerUsed: '2026-07-10T18:00:00.000Z' });
  const OR = await w.order({ accountId: accounts.W, modelId: halo, channel: 'VAULT', paid: '2026-07-11', currency: 'EUR', vaultId: vR, skuId: A, country: 'FR', shipping: { service: 'STANDARD', minor: 1_500 }, lines: [piece(90_000, 'THE VAULT'), shipping] });
  await w.link(vR, { order_id: OR });

  // vGu: K's guaranteed piece, used at a LIVE release.
  const live = await w.g.drop({ mode: 'LIVE', modelId: halo, title: 'HALO — LIVE', opens: '2026-06-01', quantity: 5 });
  const vGu = await w.vault(accounts.K, { given: '2026-05-01', opened: '2026-05-10', rewardId: rGuar, kind: 'GUARANTEED', cost: 0 });
  await w.link(vGu, { guarantee_id: await w.usedGuarantee(accounts.K, vGu, '2026-05-10', '2026-06-01T12:00:00.000Z', live.id) });

  // T, a test entrant: a HALO won free and claimed, a house credit and a free add-on on its salon order, a guarantee used.
  const vTp = await w.vault(accounts.T, { given: '2026-05-01', opened: '2026-06-10', rewardId: rFree, kind: 'PRODUCT', value: [120_000, 'EUR'] });
  const OT = await w.order({ accountId: accounts.T, modelId: halo, channel: 'VAULT', paid: '2026-06-15', currency: 'EUR', vaultId: vTp, claimBy: '2026-07-10', skuId: A, country: 'FR', lines: [piece(0, 'THE VAULT')] });
  await w.link(vTp, { order_id: OT });
  const vTc = await w.vault(accounts.T, { given: '2026-05-01', opened: '2026-06-10', rewardId: rCredit, kind: 'CREDIT', value: [2_500, 'EUR'], cost: 2_500 });
  const gT = await w.vaultGrant(accounts.T, vTc, 2_500, 'EUR', '2026-06-10');
  await w.link(vTc, { grant_id: gT });
  const vTa = await w.vault(accounts.T, { given: '2026-05-01', opened: '2026-06-10', rewardId: rAddon, kind: 'ADDON', offerUntil: '2026-07-10', offerUsed: '2026-06-20T10:00:00.000Z' });
  const OTs = await w.order({ accountId: accounts.T, modelId: halo, channel: 'SALON', paid: '2026-06-20', currency: 'EUR', skuId: A, country: 'FR', lines: [piece(100_000), { kind: 'ADD_ON_ITEM', label: 'POLISHING CLOTH', detail: 'FROM THE VAULT', amountMinor: 0 }, vaultCredit(2_500)] });
  await w.unit(OTs, cloth, { priceMinor: 0, added: '2026-06-20T10:00:00.000Z', vaultId: vTa });
  await w.creditUse(gT, OTs, 2_500, '2026-06-20T11:00:00.000Z');
  const vTg = await w.vault(accounts.T, { given: '2026-05-01', opened: '2026-05-10', rewardId: rGuar, kind: 'GUARANTEED', cost: 0 });
  await w.link(vTg, { guarantee_id: await w.usedGuarantee(accounts.T, vTg, '2026-05-10', '2026-06-01T12:00:00.000Z', live.id) });

  return {
    world: w,
    accounts,
    models: { halo, nova },
    orders: { O0, O1, O2, OW, OR, OX, ON, OT, OTs },
    vaults: { vC, vG, vA, vP, vR, vX, vN, vGu, vChf, vTp, vTc, vTa, vTg },
    releases: { live: live.id },
    box,
  };
}

export interface MarginEdgesFixture {
  world: MarginWorld;
  accounts: Record<'E' | 'H', string>;
  models: { halo: string; nova: string };
  orders: Record<'O1' | 'O2' | 'O3' | 'O4', string>;
  /** SO1's HALO line, one unit of it credited by the supplier. */
  creditedLine: string;
  releases: { live: string; draw: string };
}

/** The first plan's edge cases described in the file header (seedMarginEdges), its settings entered as rows. */
export async function seedMarginEdges(db: Db, adminId: string): Promise<MarginEdgesFixture> {
  const w = await new MarginWorld(db, adminId).prepare();
  await db.updateTable('vault_sources').set({ enabled: false }).where('source', '=', 'PIECE').execute();

  // Settings.
  await db
    .insertInto('shipping_cost_rates')
    .values([
      { country: 'FR', max_weight_g: 1000, cost_minor: 1000, currency: 'EUR' },
      { country: null, max_weight_g: 1000, cost_minor: 1500, currency: 'EUR' },
    ])
    .execute();
  await db
    .insertInto('margin_unit_costs')
    .values([
      { key: 'POUCH', cost_minor: 300, currency: 'EUR' },
      { key: 'CARD', cost_minor: 200, currency: 'EUR' },
    ])
    .execute();
  await db.insertInto('category_allowances').values({ category_id: 1, allowance_bp: 250 }).execute();

  // Catalogue and supplier prices: one unit credited, one cancelled.
  const box = await w.box('BX', 250);
  const halo = await w.model('HALO', { boxId: box, packedWeightG: 150 });
  const nova = await w.model('NOVA', { boxId: box, packedWeightG: 150 });
  const A = await w.sku(halo, '52');
  const N = await w.sku(nova, '52');
  const engraving = await w.addon('ENGRAVING', { kind: 'SERVICE', engraving: true });
  const so1 = await w.supplierOrder({
    currency: 'EUR',
    shippingMinor: 1_200,
    sent: '2026-01-05',
    lines: [
      { skuId: A, quantity: 10, priceMinor: 20_000, accepted: 9, credited: 1 },
      { skuId: N, quantity: 4, priceMinor: 30_000, accepted: 3, restCancelled: 1 },
    ],
  });
  const creditedLine = (await db.selectFrom('supplier_order_lines').select('id').where('sku_id', '=', A).executeTakeFirstOrThrow()).id;
  const piece = (amount: number, detail = 'THE PRIVATE SALON', label = 'HALO · SIZE 52'): Line => ({ kind: 'PIECE', label, detail, amountMinor: amount });

  const E = await w.g.account('2025-12-01', 'FR');
  const H = await w.g.account('2025-12-01', 'FR');
  await w.g.own(H, await w.g.piece(nova), 'FIRST_REGISTRATION', '2026-01-10');

  // O1, O2 and O3: a parcel of three paid orders, the first with its engraving (a SERVICE unit).
  const p1 = await w.piece(halo, A, so1.get(A)!);
  const O1 = await w.order({
    accountId: E,
    modelId: halo,
    channel: 'SALON',
    paid: '2026-04-01',
    currency: 'EUR',
    skuId: A,
    productId: p1,
    country: 'FR',
    lines: [piece(100_000), { kind: 'ADD_ON_ITEM', label: 'ENGRAVING', detail: 'E.M.', amountMinor: 4_000 }],
  });
  await w.unit(O1, engraving, { priceMinor: 4_000, added: '2026-04-01T10:00:00.000Z', service: true });
  const live = await w.g.drop({ mode: 'LIVE', modelId: halo, title: 'HALO — LIVE', opens: '2026-04-02', quantity: 5 });
  const p2 = await w.piece(halo, A, so1.get(A)!);
  const O2 = await w.order({
    accountId: E,
    modelId: halo,
    channel: 'LIVE',
    paid: '2026-04-02',
    currency: 'EUR',
    dropId: live.id,
    liveEntryId: await w.g.liveEntry(live, E, '2026-04-02'),
    withOrderId: O1,
    skuId: A,
    productId: p2,
    lines: [piece(100_000, 'LIVE RELEASE')],
  });
  const draw = await w.g.drop({ mode: 'DRAW', modelId: halo, title: 'HALO — DRAW', opens: '2026-04-03', quantity: 5 });
  const O3 = await w.order({
    accountId: E,
    modelId: halo,
    channel: 'DRAW',
    paid: '2026-04-03',
    currency: 'EUR',
    dropId: draw.id,
    dropEntryId: await w.g.drawEntry(draw.id, E, 'CONFIRMED', '2026-04-02'),
    withOrderId: O1,
    skuId: A,
    lines: [piece(100_000, 'DRAW')],
  });
  await w.shipment(O1, { packed: '2026-04-05', boxId: box, weightG: 600, items: [{ orderId: O1, productId: p1 }, { orderId: O2, productId: p2 }, { orderId: O3, productId: null }] });

  // O4: a parcel heavier than every band.
  const p4 = await w.piece(nova, N, so1.get(N)!);
  const O4 = await w.order({ accountId: H, modelId: nova, channel: 'SALON', paid: '2026-05-01', currency: 'EUR', skuId: N, productId: p4, country: 'FR', lines: [piece(150_000, 'THE PRIVATE SALON', 'NOVA · SIZE 52')] });
  await w.shipment(O4, { packed: '2026-05-03', boxId: box, weightG: 1_200, items: [{ orderId: O4, productId: p4 }] });

  return { world: w, accounts: { E, H }, models: { halo, nova }, orders: { O1, O2, O3, O4 }, creditedLine, releases: { live: live.id, draw: draw.id } };
}
