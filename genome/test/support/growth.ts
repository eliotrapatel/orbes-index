/**
 * GROWTH's fixture (plan NEXT-NINE, BP-29; test/services/growth.test.ts, test/api/admin-growth.test.ts): fourteen months
 * of a house, written row by row as the services leave them (accounts, pieces and their ownerships, orders of every
 * channel with their invoices and credit notes, a welcome gift, warranties, the daily scan statistics, releases), at
 * fixed instants, so that every figure of the report can be counted by hand. `seedGrowth` returns the ids; the clock of
 * the readings is GROWTH_NOW.
 *
 *   A1  FR, created Sep 2025: a SALON MONOLITHE (Sep 2025, € 4 800) registered after it, a DRAW HALO (Jan 2026, € 1 250
 *       with its shipping), 8 pieces given by ORBES (ADMIN, Mar 2026) and an ORBIT from elsewhere without a price (Jul
 *       2026): 10 held, PLATINE from Mar 2026, PALLADIUM from Jul 2026.
 *   A2  FR, Nov 2025: a LIVE MONOLITHE (Nov 2025, € 4 800) registered after it, with a welcome GIFT order; a SALON HALO
 *       returned (paid Dec 2025, credited Jan 2026); MONOLITHE IN GOLD (a variant without a price) registered from a
 *       point of sale (Feb 2026).
 *   A3  GB, Dec 2025: a SALON AURA in pounds (Feb 2026, £ 1 000); a DRAW MONOLITHE paid then cancelled (Apr 2026).
 *   A4  FR, Jan 2026: a HALO from elsewhere (Jan 2026, € 1 200); two pieces received by TRANSFER (May 2026): 3 held.
 *   A5  no country, Feb 2026: SALON HALO (Feb 2026, € 1 200), SALON MONOLITHE (Oct 2026, € 4 800 less a € 500 credit).
 *   A6  IT, Mar 2026, DELETED: SALON HALO (Mar 2026, € 1 200).
 *   A7  FR, May 2026: one piece by RESALE.
 *   A8  CH, Sep 2025: SALON HALO (Oct 2025) and SALON HALO (Oct 2026), € 1 200 each.
 *   A9  FR, Aug 2026: nothing.
 *   A10 FR, Apr 2026: a HALO from elsewhere (Apr 2026, € 1 200).
 *   A12 FR, Jun 2026: a DRAW HALO (Jun 2026, € 1 200), its first order.
 *
 * Releases: L1 (LIVE, Nov 2025, 3 pieces), D1 (DRAW, Jan 2026, 10 pieces), D2 (DRAW, Mar 2026, 5 pieces), and those
 * GROWTH's Latest releases leaves out: a draft, a cancelled release, an after-room and a release still ahead.
 * Scans: 40 in Nov 2025, 60 in Jan 2026, 10 in Sep 2025 (before the window).
 */
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { packIdentity } from '../../src/core/identity.js';
import type { Db } from '../../src/server/db/connection.js';
import { jsonText, type AcquiredVia, type AccountStatus, type OrderChannel, type OrderStatus } from '../../src/server/db/schema.js';

/** The clock of every reading of the fixture. */
export const GROWTH_NOW = new Date('2026-10-15T12:00:00.000Z');

const CATEGORY = 1;
const at = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const SEED_ENC = `v1.${'A'.repeat(16)}.${'B'.repeat(64)}`;

export class GrowthWorld {
  private serial = 0;
  private invoiceSeq = 0;
  location = '';
  carrier = '';

  constructor(readonly db: Db) {}

  async prepare(): Promise<this> {
    await this.db.insertInto('categories').values({ id: CATEGORY, code: 'J', name: 'Jewelry' }).onConflict((oc) => oc.doNothing()).execute();
    const top = await this.db.selectFrom('products').select((eb) => eb.fn.max('serial').as('s')).where('category_id', '=', CATEGORY).where('year', '=', 2025).executeTakeFirst();
    this.serial = Number(top?.s ?? 0);
    const seq = await this.db.selectFrom('invoices').select((eb) => eb.fn.max('sequence').as('s')).executeTakeFirst();
    this.invoiceSeq = Number(seq?.s ?? 0);
    const loc = await this.db.selectFrom('stock_locations').select('id').orderBy('created_at').executeTakeFirst();
    this.location = loc?.id ?? (await this.db.insertInto('stock_locations').values({ name: `Growth ${randomUUID().slice(0, 8)}` }).returning('id').executeTakeFirstOrThrow()).id;
    this.carrier = (await this.db.insertInto('carriers').values({ name: `Growth ${randomUUID().slice(0, 8)}`, tracking_url: 'https://track.test/{tracking}' }).returning('id').executeTakeFirstOrThrow()).id;
    return this;
  }

  async account(created: string, country: string | null, status: AccountStatus = 'ACTIVE'): Promise<string> {
    const email = `growth-${randomUUID()}@example.com`;
    return (
      await this.db
        .insertInto('accounts')
        .values({ email, email_normalized: email, password_hash: 'unused', country, status, created_at: at(created) })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  async model(name: string, o: { price?: [number, string]; variantOf?: string; label?: string; swatch?: string; collectionId?: string | null } = {}): Promise<string> {
    return (
      await this.db
        .insertInto('models')
        .values({
          category_id: CATEGORY,
          collection_id: o.collectionId ?? null,
          name,
          type: 'RING',
          sku_prefix: `${name.slice(0, 3)}-${randomUUID().slice(0, 8)}`,
          base_price_minor: o.price?.[0] ?? null,
          base_currency: o.price?.[1] ?? null,
          variant_of: o.variantOf ?? null,
          variant_label: o.label ?? null,
          variant_swatch: o.swatch ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  /** A piece of `modelId`, OWNED (or `status`). */
  async piece(modelId: string, status: 'OWNED' | 'ISSUED' = 'OWNED'): Promise<string> {
    const serial = ++this.serial;
    return (
      await this.db
        .insertInto('products')
        .values({
          product_id: `O25-J-${String(serial).padStart(5, '0')}`,
          packed_identity: packIdentity({ year: 2025, categoryIndex: CATEGORY, serial }),
          year: 2025,
          category_id: CATEGORY,
          serial,
          sku: `GROWTH-${serial}`,
          model_id: modelId,
          material: '925 STERLING SILVER',
          status,
          ownership_state: status === 'OWNED' ? 'OWNED' : 'UNREGISTERED',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  async own(accountId: string, productId: string, via: AcquiredVia, started: string, ended?: string): Promise<string> {
    return (
      await this.db
        .insertInto('ownership')
        .values({ product_id: productId, account_id: accountId, acquired_via: via, started_at: at(started), ended_at: ended ? at(ended) : null, ended_reason: ended ? 'TRANSFERRED' : null })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  /** A warranty of the piece, naming a point of sale when `retailer` is given. */
  async warranty(productId: string, retailer: string | null): Promise<void> {
    await this.db.insertInto('warranties').values({ product_id: productId, retailer, duration_months: 24, purchase_date: '2026-02-15', start_date: '2026-02-15' }).execute();
  }

  async drop(o: { mode: 'DRAW' | 'LIVE'; modelId: string; title: string; opens: string; quantity: number; published?: boolean; cancelled?: boolean; parentId?: string; stock?: number }): Promise<{ id: string; sizeId: string | null }> {
    const opens = at(o.opens);
    const live = o.mode === 'LIVE';
    const id = (
      await this.db
        .insertInto('drops')
        .values({
          model_id: o.modelId,
          title: o.title,
          quantity: o.quantity,
          opens_at: opens,
          closes_at: new Date(opens.getTime() + 3_600_000),
          seed_enc: SEED_ENC,
          seed_hash: new Uint8Array(createHash('sha256').update(randomUUID()).digest()),
          published_at: o.published === false ? null : new Date(opens.getTime() - 86_400_000),
          cancelled_at: o.cancelled ? new Date(opens.getTime() - 3_600_000) : null,
          mode: o.mode,
          early_access_hours: live ? 0 : 48,
          ...(live
            ? { live_min_tier: 0, tier_priority: true, room_opens_minutes: 5, turn_seconds: 30, pay_minutes: 5, per_account: 1, price_minor: 480_000, currency: 'EUR', quantity_line: `${o.quantity} PIECES`, ...(o.parentId ? { parent_drop_id: o.parentId, after_room_delay_minutes: 10, after_room_length_minutes: 15, surprise_enabled: false, question_enabled: false } : {}) }
            : {}),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const sizeId = live ? (await this.db.insertInto('drop_sizes').values({ drop_id: id, label: '52', position: 1, stock: o.stock ?? o.quantity }).returning('id').executeTakeFirstOrThrow()).id : null;
    return { id, sizeId };
  }

  /** A draw's entry: CONFIRMED (its place concluded), ENTERED or WITHDRAWN. */
  async drawEntry(dropId: string, accountId: string, status: 'CONFIRMED' | 'ENTERED' | 'WITHDRAWN', created: string, rank = 1): Promise<string> {
    const c = at(created);
    const confirmed = status === 'CONFIRMED';
    return (
      await this.db
        .insertInto('drop_entries')
        .values({
          drop_id: dropId,
          account_id: accountId,
          created_at: c,
          status,
          tier: confirmed ? 1 : null,
          seniority: confirmed ? 0 : null,
          rank: confirmed ? rank : null,
          respond_by: confirmed ? new Date(c.getTime() + 2 * 86_400_000) : null,
          handled_at: confirmed ? new Date(c.getTime() + 86_400_000) : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  /** A LIVE RELEASE's entry CONFIRMED at `confirmed`, one piece. */
  async liveEntry(drop: { id: string; sizeId: string | null }, accountId: string, confirmed: string): Promise<string> {
    const c = at(confirmed);
    const t = (ms: number) => new Date(c.getTime() - ms);
    return (
      await this.db
        .insertInto('live_entries')
        .values({
          drop_id: drop.id,
          account_id: accountId,
          size_id: drop.sizeId!,
          quantity: 1,
          status: 'CONFIRMED',
          tier: 1,
          position: 1,
          joined_at: t(600_000),
          queued_at: t(500_000),
          turn_at: t(400_000),
          turn_expires_at: t(370_000),
          turn_token_hash: new Uint8Array(32),
          press_started_at: t(395_000),
          gesture_ms: 1500,
          secured_at: t(390_000),
          hold_expires_at: t(90_000),
          confirmed_at: c,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  /**
   * An order paid at `paid` for `total` in `currency` (its invoice issued then, with `lines`); RETURNED or CANCELLED with
   * its credit note issued at `ended`. Its source: a salon's request (SALON), a draw's entry, a LIVE entry, or the order
   * a GIFT travels with (no invoice).
   */
  async order(o: {
    accountId: string;
    modelId: string;
    channel: OrderChannel;
    paid: string;
    total: number;
    currency: string;
    status?: OrderStatus;
    ended?: string;
    productId?: string | null;
    dropId?: string;
    dropEntryId?: string;
    liveEntryId?: string;
    withOrderId?: string;
    giftGrantId?: string;
    lines?: { kind: string; label: string; detail: string | null; amountMinor: number }[];
  }): Promise<string> {
    const paid = at(o.paid);
    const status = o.status ?? 'PAID';
    const ended = o.ended ? at(o.ended) : null;
    const shopRequest =
      o.channel === 'SALON'
        ? (
            await this.db
              .insertInto('shop_requests')
              .values({ account_id: o.accountId, model_id: o.modelId, status: 'CLOSED', created_at: new Date(paid.getTime() - 86_400_000), handled_at: new Date(paid.getTime() - 3_600_000), outcome: 'ACCEPTED' })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id
        : null;
    const shipped = status === 'RETURNED' ? new Date(paid.getTime() + 86_400_000) : null;
    const id = (
      await this.db
        .insertInto('orders')
        .values({
          channel: o.channel,
          account_id: o.accountId,
          model_id: o.modelId,
          shop_request_id: shopRequest,
          drop_id: o.channel === 'SALON' || o.channel === 'GIFT' ? null : o.dropId!,
          drop_entry_id: o.dropEntryId ?? null,
          live_entry_id: o.liveEntryId ?? null,
          with_order_id: o.withOrderId ?? null,
          gift_grant_id: o.giftGrantId ?? null,
          price_minor: o.channel === 'GIFT' ? 0 : o.total,
          currency: o.currency,
          status,
          reserved_at: new Date(paid.getTime() - 3_600_000),
          paid_at: paid,
          shipped_at: shipped,
          carrier_id: shipped ? this.carrier : null,
          tracking_number: shipped ? 'GROWTH-123' : null,
          returned_at: status === 'RETURNED' ? ended : null,
          cancelled_at: status === 'CANCELLED' ? ended : null,
          location_id: this.location,
          product_id: o.productId ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    if (o.channel === 'GIFT') return id;
    const lines = o.lines ?? [{ kind: 'PIECE', label: 'PIECE', detail: o.channel, amountMinor: o.total }];
    const invoice = await this.invoice(id, 'INVOICE', paid, o.currency, o.total, lines, null);
    if (ended) await this.invoice(id, 'CREDIT_NOTE', ended, o.currency, o.total, lines, invoice);
    return id;
  }

  private async invoice(orderId: string, kind: 'INVOICE' | 'CREDIT_NOTE', issued: Date, currency: string, total: number, lines: unknown[], credits: string | null): Promise<string> {
    return (
      await this.db
        .insertInto('invoices')
        .values({
          kind,
          year: issued.getUTCFullYear(),
          sequence: ++this.invoiceSeq,
          order_id: orderId,
          credits_invoice_id: credits,
          issuer: jsonText({ name: 'CONGLOMERAT LLC', address: ['30 N Gould St, Ste N', 'Sheridan, WY 82801', 'United States'] }),
          buyer: jsonText({ name: null, address: null, email: null }),
          lines: jsonText(lines),
          currency,
          subtotal_minor: total,
          total_minor: total,
          issued_at: issued,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }

  /** A tier's welcome-gift grant of the account. */
  async giftGrant(accountId: string, modelId: string, granted: string): Promise<string> {
    return (await this.db.insertInto('tier_grants').values({ account_id: accountId, tier: 2, kind: 'GIFT', granted_at: at(granted), model_id: modelId }).returning('id').executeTakeFirstOrThrow()).id;
  }

  async scans(day: string, n: number, country = 'FR'): Promise<void> {
    await this.db.insertInto('scan_daily_stats').values({ day, country, result_state: 'AUTHENTIC', event_type: 'VERIFY', n }).execute();
  }
}

export interface GrowthFixture {
  world: GrowthWorld;
  accounts: Record<'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'A8' | 'A9' | 'A10' | 'A12', string>;
  models: { monolithe: string; gold: string; halo: string; orbit: string; aura: string };
  releases: { L1: string; D1: string; D2: string; draft: string; cancelled: string; afterRoom: string; ahead: string };
  orders: { a2Live: string; a2Gift: string; a2Returned: string; a3Cancelled: string; a5Credited: string };
}

/** The fourteen months described in the file header. */
export async function seedGrowth(db: Db): Promise<GrowthFixture> {
  const w = await new GrowthWorld(db).prepare();
  const monolithe = await w.model('MONOLITHE', { price: [480_000, 'EUR'], label: 'Steel', swatch: '#8A8D91' });
  const gold = await w.model('MONOLITHE', { variantOf: monolithe, label: 'Gold', swatch: '#C9A55C' });
  const halo = await w.model('HALO', { price: [120_000, 'EUR'] });
  const orbit = await w.model('ORBIT');
  const aura = await w.model('AURA', { price: [100_000, 'GBP'] });

  const A1 = await w.account('2025-09-10', 'FR');
  const A2 = await w.account('2025-11-05', 'FR');
  const A3 = await w.account('2025-12-01', 'GB');
  const A4 = await w.account('2026-01-20', 'FR');
  const A5 = await w.account('2026-02-02', null);
  const A6 = await w.account('2026-03-03', 'IT', 'DELETED');
  const A7 = await w.account('2026-05-05', 'FR');
  const A8 = await w.account('2025-09-01', 'CH');
  const A9 = await w.account('2026-08-08', 'FR');
  const A10 = await w.account('2026-04-04', 'FR');
  const A12 = await w.account('2026-06-01', 'FR');

  // Releases.
  const L1 = await w.drop({ mode: 'LIVE', modelId: monolithe, title: 'MONOLITHE — LIVE', opens: '2025-11-20', quantity: 3 });
  const D1 = await w.drop({ mode: 'DRAW', modelId: halo, title: 'HALO — DRAW', opens: '2026-01-05', quantity: 10 });
  const D2 = await w.drop({ mode: 'DRAW', modelId: monolithe, title: 'MONOLITHE — DRAW', opens: '2026-03-25', quantity: 5 });
  const draft = await w.drop({ mode: 'DRAW', modelId: halo, title: 'DRAFT', opens: '2026-05-01', quantity: 5, published: false });
  const cancelled = await w.drop({ mode: 'DRAW', modelId: halo, title: 'CANCELLED', opens: '2026-06-01', quantity: 5, cancelled: true });
  const afterRoom = await w.drop({ mode: 'LIVE', modelId: monolithe, title: 'AFTER-ROOM', opens: '2025-11-21', quantity: 2, parentId: L1.id });
  const ahead = await w.drop({ mode: 'DRAW', modelId: halo, title: 'AHEAD', opens: '2026-11-01', quantity: 5 });

  // A1: a SALON MONOLITHE registered after it, a DRAW HALO with its shipping, 8 pieces from ORBES, an ORBIT from elsewhere.
  const p1 = await w.piece(monolithe);
  await w.order({ accountId: A1, modelId: monolithe, channel: 'SALON', paid: '2025-09-20', total: 480_000, currency: 'EUR', productId: p1 });
  await w.own(A1, p1, 'FIRST_REGISTRATION', '2025-09-25');
  const e1 = await w.drawEntry(D1.id, A1, 'CONFIRMED', '2026-01-04', 1);
  await w.order({
    accountId: A1,
    modelId: halo,
    channel: 'DRAW',
    paid: '2026-01-10',
    total: 125_000,
    currency: 'EUR',
    dropId: D1.id,
    dropEntryId: e1,
    lines: [
      { kind: 'PIECE', label: 'HALO', detail: 'DRAW', amountMinor: 120_000 },
      { kind: 'SHIPPING', label: 'SHIPPING · STANDARD', detail: null, amountMinor: 5_000 },
    ],
  });
  for (let i = 0; i < 8; i++) await w.own(A1, await w.piece(orbit), 'ADMIN', '2026-03-01');
  await w.own(A1, await w.piece(orbit), 'FIRST_REGISTRATION', '2026-07-01');

  // A2: a LIVE MONOLITHE registered after it, its welcome gift; a SALON HALO returned; MONOLITHE IN GOLD from a point of sale.
  const p2 = await w.piece(monolithe);
  const le = await w.liveEntry(L1, A2, '2025-11-20');
  const a2Live = await w.order({ accountId: A2, modelId: monolithe, channel: 'LIVE', paid: '2025-11-20', total: 480_000, currency: 'EUR', dropId: L1.id, liveEntryId: le, productId: p2 });
  const grant = await w.giftGrant(A2, halo, '2025-11-19');
  const a2Gift = await w.order({ accountId: A2, modelId: halo, channel: 'GIFT', paid: '2025-11-20', total: 0, currency: 'EUR', withOrderId: a2Live, giftGrantId: grant });
  await w.own(A2, p2, 'FIRST_REGISTRATION', '2025-11-25');
  const a2Returned = await w.order({ accountId: A2, modelId: halo, channel: 'SALON', paid: '2025-12-10', total: 120_000, currency: 'EUR', status: 'RETURNED', ended: '2026-01-05' });
  const goldPiece = await w.piece(gold);
  await w.warranty(goldPiece, 'ORBES PARIS — SAINT-HONORÉ');
  await w.own(A2, goldPiece, 'FIRST_REGISTRATION', '2026-02-15');

  // A3: pounds; a DRAW paid then cancelled.
  await w.order({ accountId: A3, modelId: aura, channel: 'SALON', paid: '2026-02-01', total: 100_000, currency: 'GBP' });
  const e3 = await w.drawEntry(D2.id, A3, 'CONFIRMED', '2026-03-24', 1);
  const a3Cancelled = await w.order({ accountId: A3, modelId: monolithe, channel: 'DRAW', paid: '2026-04-01', total: 480_000, currency: 'EUR', status: 'CANCELLED', ended: '2026-04-03', dropId: D2.id, dropEntryId: e3 });

  // A4: a HALO from elsewhere (no warranty); two pieces by transfer.
  await w.own(A4, await w.piece(halo), 'FIRST_REGISTRATION', '2026-01-25');
  for (let i = 0; i < 2; i++) await w.own(A4, await w.piece(orbit), 'TRANSFER', '2026-05-01');
  await w.drawEntry(D1.id, A4, 'WITHDRAWN', '2026-01-03');

  // A5: two SALON orders, the second less a credit.
  await w.order({ accountId: A5, modelId: halo, channel: 'SALON', paid: '2026-02-20', total: 120_000, currency: 'EUR' });
  const a5Credited = await w.order({
    accountId: A5,
    modelId: monolithe,
    channel: 'SALON',
    paid: '2026-10-01',
    total: 430_000,
    currency: 'EUR',
    lines: [
      { kind: 'PIECE', label: 'MONOLITHE', detail: 'THE PRIVATE SALON', amountMinor: 480_000 },
      { kind: 'CREDIT', label: 'CREDIT · PALLADIUM', detail: null, amountMinor: -50_000 },
    ],
  });
  await w.drawEntry(D1.id, A5, 'ENTERED', '2026-01-02');

  // A6 (DELETED), A7 (a resale), A8 (two HALO a year apart), A10 (a HALO from elsewhere), A12 (a DRAW, its first order).
  await w.order({ accountId: A6, modelId: halo, channel: 'SALON', paid: '2026-03-10', total: 120_000, currency: 'EUR' });
  await w.own(A7, await w.piece(orbit), 'RESALE', '2026-05-06');
  await w.order({ accountId: A8, modelId: halo, channel: 'SALON', paid: '2025-10-10', total: 120_000, currency: 'EUR' });
  await w.order({ accountId: A8, modelId: halo, channel: 'SALON', paid: '2026-10-12', total: 120_000, currency: 'EUR' });
  await w.own(A10, await w.piece(halo), 'FIRST_REGISTRATION', '2026-04-10');
  const e12 = await w.drawEntry(D1.id, A12, 'CONFIRMED', '2026-01-04', 2);
  await w.order({ accountId: A12, modelId: halo, channel: 'DRAW', paid: '2026-06-15', total: 120_000, currency: 'EUR', dropId: D1.id, dropEntryId: e12 });

  // Scans: two months of the window, one before it.
  await w.scans('2025-09-15', 10);
  await w.scans('2025-11-03', 40);
  await w.scans('2026-01-10', 60, 'GB');

  return {
    world: w,
    accounts: { A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A12 },
    models: { monolithe, gold, halo, orbit, aura },
    releases: { L1: L1.id, D1: D1.id, D2: D2.id, draft: draft.id, cancelled: cancelled.id, afterRoom: afterRoom.id, ahead: ahead.id },
    orders: { a2Live, a2Gift, a2Returned, a3Cancelled, a5Credited },
  };
}

/**
 * The house scripts/bench.ts measures GROWTH on (plan NEXT-NINE, §3.9 Tests: Load; `--only growth`), written in bulk
 * (generate_series), as test data is: `accounts` accounts created over two years in six countries; `pieces` pieces of
 * three models (`modelId` priced € 4 800, HALO € 1 200, ORBIT without a price), each with one ownership (seven in ten
 * registered first, two received by transfer, one given by ORBES); `orders` paid orders of the private salon on the
 * first pieces, one in ten in pounds and one in twenty cancelled with its credit note, each with its invoice; the daily
 * scans of two years. The category J must exist.
 */
export async function seedGrowthHouse(db: Db, o: { modelId: string; accounts: number; pieces: number; orders: number }): Promise<void> {
  const { accounts, pieces, orders } = o;
  const base = new Date();
  const category = (await db.selectFrom('categories').select('id').where('code', '=', 'J').executeTakeFirstOrThrow()).id;
  const location = (await db.selectFrom('stock_locations').select('id').orderBy('created_at').executeTakeFirstOrThrow()).id;
  await sql`UPDATE models SET base_price_minor = 480000, base_currency = 'EUR' WHERE id = ${o.modelId}`.execute(db);
  const halo = (await db.insertInto('models').values({ category_id: category, name: 'HALO', type: 'RING', sku_prefix: `HAL-${randomUUID().slice(0, 6)}`, base_price_minor: 120_000, base_currency: 'EUR' }).returning('id').executeTakeFirstOrThrow()).id;
  const orbit = (await db.insertInto('models').values({ category_id: category, name: 'ORBIT', type: 'RING', sku_prefix: `ORB-${randomUUID().slice(0, 6)}` }).returning('id').executeTakeFirstOrThrow()).id;
  await sql`
    INSERT INTO accounts (email, email_normalized, password_hash, country, created_at)
    SELECT 'growth-' || i || '@bench.test', 'growth-' || i || '@bench.test', 'unused',
           (ARRAY['FR', 'GB', 'US', 'IT', 'DE', NULL])[1 + i % 6], ${base}::timestamptz - (i % 730) * interval '1 day'
      FROM generate_series(1, ${accounts}) i`.execute(db);
  await sql`
    INSERT INTO products (product_id, packed_identity, year, category_id, serial, sku, model_id, material, status, ownership_state)
    SELECT 'O25-J-' || CASE WHEN i < 100000 THEN lpad(i::text, 5, '0') ELSE i::text END,
           ((25::bigint << 25) | (${category}::bigint << 20) | i), 2025, ${category}, i, 'GROWTH-' || i,
           (ARRAY[${o.modelId}::uuid, ${halo}::uuid, ${orbit}::uuid])[1 + i % 3], '925 STERLING SILVER', 'OWNED', 'OWNED'
      FROM generate_series(1, ${pieces}) i`.execute(db);
  await sql`
    WITH a AS (SELECT id, row_number() OVER (ORDER BY email) AS n FROM accounts WHERE email LIKE 'growth-%@bench.test'),
         p AS (SELECT id, serial FROM products WHERE sku LIKE 'GROWTH-%')
    INSERT INTO ownership (product_id, account_id, acquired_via, started_at)
    SELECT p.id, a.id, CASE WHEN p.serial % 10 < 7 THEN 'FIRST_REGISTRATION' WHEN p.serial % 10 < 9 THEN 'TRANSFER' ELSE 'ADMIN' END,
           ${base}::timestamptz - (p.serial % 700) * interval '1 day'
      FROM p JOIN a ON a.n = 1 + p.serial % ${accounts}`.execute(db);
  // One request of the private salon per order, named by its piece's serial so that its order finds it.
  await sql`
    INSERT INTO shop_requests (account_id, model_id, note, status, created_at, handled_at, outcome)
    SELECT w.account_id, p.model_id, 'GROWTH-' || p.serial, 'CLOSED',
           ${base}::timestamptz - (p.serial % 700) * interval '1 day' - interval '2 hours',
           ${base}::timestamptz - (p.serial % 700) * interval '1 day' - interval '1 hour', 'ACCEPTED'
      FROM ownership w JOIN products p ON p.id = w.product_id
     WHERE p.sku LIKE 'GROWTH-%' AND p.serial <= ${orders}`.execute(db);
  await sql`
    INSERT INTO orders (channel, account_id, model_id, shop_request_id, price_minor, currency, status, reserved_at, paid_at, cancelled_at, location_id, product_id)
    SELECT 'SALON', r.account_id, r.model_id, r.id, CASE WHEN r.model_id = ${halo}::uuid THEN 120000 ELSE 480000 END,
           CASE WHEN p.serial % 10 = 0 THEN 'GBP' ELSE 'EUR' END,
           CASE WHEN p.serial % 20 = 1 THEN 'CANCELLED' ELSE 'PAID' END,
           r.handled_at, r.handled_at + interval '30 minutes',
           CASE WHEN p.serial % 20 = 1 THEN r.handled_at + interval '1 day' END,
           ${location}::uuid, CASE WHEN p.serial % 20 = 1 THEN NULL ELSE p.id END
      FROM shop_requests r JOIN products p ON p.sku = r.note
     WHERE r.note LIKE 'GROWTH-%'`.execute(db);
  const lines = JSON.stringify([{ kind: 'PIECE', label: 'PIECE', detail: 'THE PRIVATE SALON', amountMinor: 0 }]);
  await sql`
    INSERT INTO invoices (kind, year, sequence, order_id, issuer, buyer, lines, currency, subtotal_minor, total_minor, issued_at)
    SELECT 'INVOICE', extract(year FROM paid_at AT TIME ZONE 'UTC')::int, row_number() OVER (ORDER BY id), id, '{"name":"CONGLOMERAT LLC"}', '{}', ${lines}::jsonb,
           currency, price_minor, price_minor, paid_at
      FROM orders WHERE channel = 'SALON' AND paid_at IS NOT NULL`.execute(db);
  await sql`
    INSERT INTO invoices (kind, year, sequence, order_id, credits_invoice_id, issuer, buyer, lines, currency, subtotal_minor, total_minor, issued_at)
    SELECT 'CREDIT_NOTE', extract(year FROM o.cancelled_at AT TIME ZONE 'UTC')::int, row_number() OVER (ORDER BY o.id), o.id, i.id, i.issuer, i.buyer, i.lines,
           i.currency, i.subtotal_minor, i.total_minor, o.cancelled_at
      FROM orders o JOIN invoices i ON i.order_id = o.id AND i.kind = 'INVOICE' WHERE o.status = 'CANCELLED'`.execute(db);
  await sql`
    INSERT INTO scan_daily_stats (day, country, result_state, event_type, n)
    SELECT (${base}::timestamptz - d * interval '1 day')::date, c, 'AUTHENTIC', 'VERIFY', 20 + d % 40
      FROM generate_series(1, 730) d, unnest(ARRAY['FR', 'GB', 'US']) c`.execute(db);
  await sql`ANALYZE`.execute(db);
}
