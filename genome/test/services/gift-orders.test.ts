/**
 * The welcome gift as an order (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T5, step 2.5; migration 0027), on the services
 * as createContext wires them:
 *
 *  - added to the account's next order (a salon's, a draw's priced or not, a LIVE entry's first piece), never without a gift model or
 *    with an inactive one, never twice for one grant (one open GIFT order per grant, whatever runs at once);
 *  - a model of one size holds its piece at once (in stock here), its grant's model recorded; a model of several sizes
 *    waits for its size, and its order is not paid before it (409 ORDER_GIFT_SIZE_MISSING);
 *  - a parent with no currency yet gives its gift no price; priced, the gift takes 0 in its currency; the gift travels
 *    with it (its shipping at 0), has no price of its own (409 ORDER_TERMS_FIXED) and is never paid alone;
 *  - paid with its order, with no invoice of its own: the order's invoice carries its GIFT line at 0; an invoice at the
 *    most lines it carries (six add-ons, its shipping, a credit split over both tiers, both tiers' gifts) is drawn;
 *  - cancelled with its order: its grant waits again, and the next order receives it; a return of its order leaves it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inTransaction } from '../../src/server/db/connection.js';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { INVOICE_MAX_LINES } from '../../src/server/render/invoice.js';
import { linesOf } from '../../src/server/services/invoices.js';
import { LIVE_ADDONS_MAX } from '../../src/server/services/live.js';
import { attachGifts, orderReference } from '../../src/server/services/orders.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { createAccount, createLiveRelease, createModel, holdPieces, liveFixtureOn, type LiveFixture } from '../support/live.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

async function rejects(p: Promise<unknown>, code: string): Promise<void> {
  const e = await p.then(
    () => {
      throw new Error(`expected ${code}`);
    },
    (x: unknown) => x,
  );
  expect(e, String(e)).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
}

describe('the welcome gift (BP-19 T5)', () => {
  let t: TestDb;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: LiveFixture;
  let admin: Actor;
  let france: string;
  let colissimo: string;

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock('2026-11-03T09:00:00.000Z');
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    f = await liveFixtureOn(ctx, clock);
    admin = f.admin;
    france = (await t.db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
    colissimo = (await t.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
  });
  afterAll(async () => {
    await ctx.close();
    await t.close();
  });

  const orders = () => ctx.services.orders;
  const orderRow = (id: string) => t.db.selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const giftsOf = (parentId: string) => t.db.selectFrom('orders').selectAll().where('with_order_id', '=', parentId).where('channel', '=', 'GIFT').orderBy('reserved_at').execute();
  const auditsOf = (id: string, action: string) => t.db.selectFrom('audit_logs').select(['details']).where('target_id', '=', id).where('action', '=', action).orderBy('id').execute();
  const setGift = async (tier: 2 | 3, modelId: string | null) => {
    const p = await ctx.services.clubProgram.read();
    await ctx.services.clubProgram.update({ ...p, ...(tier === 2 ? { giftPlatineModelId: modelId } : { giftPalladiumModelId: modelId }) }, admin);
  };
  const account = async (pieces: number) => {
    const a = await createAccount(t.db);
    await holdPieces(t.db, a.id, pieces, f.modelId);
    return a;
  };
  const pay = (id: string) => {
    clock.advance(MINUTE);
    return orders().transition(id, { to: 'PAID' }, admin);
  };
  /** A model of the catalogue with these sizes (none: one size, its SKU made by the gift), `stock` pieces of each counted. */
  async function giftModel(name: string, sizes: (string | null)[], stock = 0) {
    const id = await createModel(t.db, name);
    for (const s of sizes) {
      const sku = await inTransaction(t.db, (tx) => ensureSku(tx, id, s));
      if (stock > 0) await ctx.services.stock.adjust({ skuId: sku, locationId: france, delta: stock, note: 'Counted.' }, admin);
    }
    return id;
  }
  /** A private salon's order closed as ACCEPTED for `accountId`; priced when `priceMinor` is given. */
  async function salonOrder(accountId: string, o: { priceMinor?: number } = {}) {
    const request = await t.db.insertInto('shop_requests').values({ account_id: accountId, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
    clock.advance(MINUTE);
    await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, admin);
    const id = (await t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).where('channel', '=', 'SALON').executeTakeFirstOrThrow()).id;
    if (o.priceMinor !== undefined) await orders().setTerms(id, { sizeLabel: '58', priceMinor: o.priceMinor, currency: 'EUR' }, admin);
    return id;
  }

  it('adds no gift without a gift model, or below PLATINE; then one GIFT order to the next order, holding its one size at once', async () => {
    await setGift(2, null);
    const a = await account(5);
    const none = await salonOrder(a.id);
    expect(await giftsOf(none)).toEqual([]);
    // Below PLATINE, with a gift model: none either.
    const ring = await giftModel('ANNEAU', [null], 2);
    await setGift(2, ring);
    const titane = await account(1);
    expect(await giftsOf(await salonOrder(titane.id))).toEqual([]);
    // Its next order receives it: one size, held in stock at once, at the parent's location.
    const parent = await salonOrder(a.id);
    const [gift] = await giftsOf(parent);
    expect(gift).toMatchObject({ channel: 'GIFT', model_id: ring, size_label: null, reservation: 'STOCK', status: 'RESERVED', price_minor: null, currency: null, location_id: (await orderRow(parent)).location_id });
    expect(gift!.sku_id).not.toBeNull();
    const grant = await t.db.selectFrom('tier_grants').selectAll().where('id', '=', gift!.gift_grant_id!).executeTakeFirstOrThrow();
    expect(grant).toMatchObject({ account_id: a.id, tier: 2, kind: 'GIFT', model_id: ring });
    expect((await auditsOf(parent, 'order.gift'))[0]!.details).toMatchObject({ giftOrderId: gift!.id, grantId: grant.id, tier: 2, modelId: ring, sizeToChoose: false });
    // The parent's page says it; the gift's says its tier.
    expect((await orders().get(parent)).gift).toEqual({ id: gift!.id, reference: orderReference(gift!.id), model: 'ANNEAU', status: 'RESERVED', sizeToChoose: false });
    expect((await orders().get(gift!.id)).giftOf).toEqual({ tier: 2, sizes: [] });
    expect((await orders().get(gift!.id)).withOrder).toEqual({ id: parent, reference: orderReference(parent), shipment: null });
    // Never twice: the order after has none.
    expect(await giftsOf(await salonOrder(a.id))).toEqual([]);
    // The collector reads it as a welcome gift travelling with its order.
    const mine = (await orders().forAccount(a.id)).find((o) => o.id === gift!.id)!;
    expect(mine).toMatchObject({ channel: 'GIFT', giftTier: 'PLATINE', withOrder: orderReference(parent) });
  });

  it('gives no gift with an inactive model', async () => {
    const off = await giftModel('BAGUE', [null]);
    await setGift(2, off);
    await t.db.updateTable('models').set({ active: false }).where('id', '=', off).execute();
    const a = await account(5);
    expect(await giftsOf(await salonOrder(a.id))).toEqual([]);
    expect(await t.db.selectFrom('orders').select('id').where('account_id', '=', a.id).where('channel', '=', 'GIFT').execute()).toEqual([]);
  });

  it('waits for its size among several: its order is not paid before; priced with its order at 0, paid with it, the GIFT line on the order\'s invoice', async () => {
    const sized = await giftModel('JONC', ['52', '54'], 1);
    await setGift(2, sized);
    const a = await account(5);
    const parent = await salonOrder(a.id);
    const [gift] = await giftsOf(parent);
    expect(gift).toMatchObject({ sku_id: null, reservation: null, price_minor: null, currency: null });
    expect((await orders().get(gift!.id)).giftOf!.sizes.map((s) => [s.label, s.available])).toEqual([
      ['52', 1],
      ['54', 1],
    ]);
    expect((await orders().get(parent)).gift!.sizeToChoose).toBe(true);
    // Priced: the gift takes 0 in its currency, travels with it (its shipping at 0).
    await orders().setTerms(parent, { sizeLabel: '58', priceMinor: 300_000, currency: 'EUR' }, admin);
    expect(await orderRow(gift!.id)).toMatchObject({ price_minor: 0, currency: 'EUR', shipping_service: 'STANDARD', shipping_minor: 0 });
    await rejects(pay(parent), 'ORDER_GIFT_SIZE_MISSING');
    // No price of its own; never paid alone.
    await rejects(orders().setTerms(gift!.id, { priceMinor: 100, currency: 'EUR' }, admin), 'ORDER_TERMS_FIXED');
    await orders().setTerms(gift!.id, { sizeLabel: '54' }, admin);
    expect(await orderRow(gift!.id)).toMatchObject({ size_label: '54', reservation: 'STOCK' });
    await rejects(pay(gift!.id), 'ORDER_TRANSITION_NOT_ALLOWED');
    await pay(parent);
    expect(await orderRow(gift!.id)).toMatchObject({ status: 'PAID' });
    // One invoice, the order's, with the gift's line at 0.
    expect(await t.db.selectFrom('invoices').select('id').where('order_id', '=', gift!.id).execute()).toEqual([]);
    const invoice = await t.db.selectFrom('invoices').selectAll().where('order_id', '=', parent).executeTakeFirstOrThrow();
    const giftLine = linesOf(invoice.lines).find((l) => l.kind === 'GIFT')!;
    expect(giftLine).toEqual({ kind: 'GIFT', label: 'WELCOME GIFT · JONC', detail: `ORDER ${orderReference(gift!.id)}`, amountMinor: 0 });
    expect(invoice.total_minor).toBe(300_000);
  });

  it('is cancelled with its order: its grant waits again, and the next order receives it', async () => {
    const ring = await giftModel('ANNEAU II', [null], 3);
    await setGift(2, ring);
    const a = await account(5);
    const first = await salonOrder(a.id, { priceMinor: 200_000 });
    const [gift] = await giftsOf(first);
    clock.advance(MINUTE);
    await orders().transition(first, { to: 'CANCELLED', note: 'The client changed their mind.' }, admin);
    expect(await orderRow(gift!.id)).toMatchObject({ status: 'CANCELLED', reservation: null });
    const next = await salonOrder(a.id);
    const [again] = await giftsOf(next);
    expect(again!.gift_grant_id).toBe(gift!.gift_grant_id);
  });

  it('stays as it is when its order is returned', async () => {
    const ring = await giftModel('ANNEAU III', [null], 2);
    await setGift(2, ring);
    const a = await account(5);
    const sku = await inTransaction(t.db, (tx) => ensureSku(tx, f.modelId, '60'));
    await ctx.services.stock.adjust({ skuId: sku, locationId: france, delta: 1, note: 'Counted.' }, admin);
    const issued = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: f.modelId, variant: '60', material: '925 STERLING SILVER' }, admin);
    const parent = await salonOrder(a.id);
    await orders().setTerms(parent, { sizeLabel: '60', priceMinor: 480_000, currency: 'EUR' }, admin);
    await ctx.services.atelier.linkFromStock(parent, issued.product.productId, admin);
    await pay(parent);
    clock.advance(MINUTE);
    await orders().transition(parent, { to: 'SHIPPED', carrierId: colissimo, trackingNumber: '6A12345678901' }, admin);
    const [gift] = await giftsOf(parent);
    // SHIP WITH ITS ORDER: the gift's page reads its order's carrier and tracking number.
    expect((await orders().get(gift!.id)).withOrder!.shipment).toEqual({ carrierId: colissimo, trackingNumber: '6A12345678901' });
    clock.advance(MINUTE);
    await orders().returnOrder(parent, { outcome: 'RESTOCKED', locationId: france, note: 'Returned unworn.' }, admin);
    expect(await orderRow(gift!.id)).toMatchObject({ status: 'PAID' });
  });

  /** A draw of one piece won by `account`, unpriced or at `priceMinor` EUR: published, entered, drawn, confirmed. Its order. */
  async function drawOrder(account: { id: string; actor: Actor }, o: { priceMinor?: number } = {}) {
    const opensAt = new Date(clock.now().getTime() + HOUR);
    const drop = await ctx.services.drops.create(
      {
        modelId: f.modelId,
        title: 'A DRAW',
        quantity: 1,
        opensAt,
        closesAt: new Date(opensAt.getTime() + HOUR),
        earlyAccessHours: 0,
        earlyAccessPlatineHours: 0,
        ...(o.priceMinor !== undefined ? { priceMinor: o.priceMinor, currency: 'EUR' } : {}),
      },
      admin,
    );
    await ctx.services.drops.publish(drop.id, admin);
    clock.set(new Date(opensAt.getTime() + MINUTE));
    await ctx.services.drops.enter(account.id, drop.id, account.actor);
    clock.advance(HOUR);
    await ctx.services.drops.draw(drop.id, admin);
    const entry = await t.db.selectFrom('drop_entries').select('id').where('drop_id', '=', drop.id).executeTakeFirstOrThrow();
    await ctx.services.drops.confirm(drop.id, entry.id, null, admin);
    return t.db.selectFrom('orders').selectAll().where('drop_entry_id', '=', entry.id).where('channel', '=', 'DRAW').executeTakeFirstOrThrow();
  }

  it('goes with a draw\'s order: unpriced, the gift has no price until its order is priced, then 0 in its currency; priced, 0 at once', async () => {
    const ring = await giftModel('ANNEAU VI', [null], 3);
    await setGift(2, ring);
    const a = await account(5);
    // An unpriced draw: its order has no currency; the gift neither, and travels with it (PLATINE's free standard at 0).
    const draw = await drawOrder(a);
    expect(draw).toMatchObject({ price_minor: null, currency: null, shipping_service: 'STANDARD', shipping_minor: 0, shipping_benefit: 2 });
    const [gift] = await giftsOf(draw.id);
    expect(gift).toMatchObject({ channel: 'GIFT', with_order_id: draw.id, model_id: ring, price_minor: null, currency: null, shipping_service: 'STANDARD', shipping_minor: 0, shipping_benefit: null, reservation: 'STOCK' });
    expect((await auditsOf(draw.id, 'order.gift'))[0]!.details).toMatchObject({ giftOrderId: gift!.id, tier: 2, modelId: ring });
    // Client Services prices the draw's order: the gift takes 0 in its currency, in the same change.
    await orders().setTerms(draw.id, { sizeLabel: '52', priceMinor: 420_000, currency: 'EUR' }, admin);
    expect(await orderRow(gift!.id)).toMatchObject({ price_minor: 0, currency: 'EUR' });
    // A priced draw: the next PLATINE account's gift is created at 0 in the draw's currency at once.
    const b = await account(5);
    const priced = await drawOrder(b, { priceMinor: 450_000 });
    expect(priced).toMatchObject({ price_minor: 450_000, currency: 'EUR' });
    const [pricedGift] = await giftsOf(priced.id);
    expect(pricedGift).toMatchObject({ with_order_id: priced.id, price_minor: 0, currency: 'EUR', shipping_service: 'STANDARD', shipping_minor: 0 });
    await setGift(2, null);
  });

  it('goes with the first order of a LIVE entry of several pieces only', async () => {
    const ring = await giftModel('ANNEAU IV', [null], 2);
    await setGift(2, ring);
    const a = await account(5);
    const opensAt = new Date(clock.now().getTime() + HOUR);
    const r = await createLiveRelease(f, { opensAt, sizes: [{ label: '52', stock: 5 }], perAccount: 2, priceMinor: 480_000 });
    clock.set(new Date(opensAt.getTime() - MINUTE));
    await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id, quantity: 2 }, a.actor);
    clock.set(opensAt);
    await f.live.advance(r.id);
    const token = (await f.live.entry(a.id, r.id))!.turn!.token!;
    await f.live.press(a.id, r.id, token);
    clock.advance(1500);
    await f.live.secure(a.id, r.id, token, a.actor);
    await f.live.confirm(a.id, r.id, a.actor);
    const entry = await t.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', a.id).executeTakeFirstOrThrow();
    const [first, second] = await t.db.selectFrom('orders').selectAll().where('live_entry_id', '=', entry.id).where('channel', '=', 'LIVE').orderBy('piece').execute();
    const gifts = await giftsOf(first!.id);
    expect(gifts).toHaveLength(1);
    expect(gifts[0]).toMatchObject({ price_minor: 0, currency: first!.currency });
    expect(await giftsOf(second!.id)).toEqual([]);
  });

  it('gives one grant one open gift, whatever runs at once', async () => {
    // Two orders of the account made before its gift model was chosen; their gifts added at once, each in its transaction.
    await setGift(2, null);
    const a = await account(5);
    const parents = [await orderRow(await salonOrder(a.id)), await orderRow(await salonOrder(a.id))];
    const ring = await giftModel('ANNEAU V', [null], 5);
    await setGift(2, ring);
    const made = await Promise.all(parents.map((p) => inTransaction(t.db, (tx) => attachGifts(tx, p, admin, clock.now()))));
    expect(made.map((m) => m.orders.length).sort()).toEqual([0, 1]);
    const open = await t.db.selectFrom('orders').select('gift_grant_id').where('account_id', '=', a.id).where('channel', '=', 'GIFT').where('status', '<>', 'CANCELLED').execute();
    expect(open).toHaveLength(1);
    await setGift(2, null);
  });
  it('draws an invoice at the most lines it carries: six add-ons, its shipping, a credit split over both tiers and both tiers\' gifts', async () => {
    const [platineGift, palladiumGift] = [await giftModel('ANNEAU VII', [null], 2), await giftModel('ANNEAU VIII', [null], 2)];
    await setGift(2, platineGift);
    await setGift(3, palladiumGift);
    const a = await account(10);
    const opensAt = new Date(clock.now().getTime() + HOUR);
    const r = await createLiveRelease(f, {
      opensAt,
      sizes: [{ label: '52', stock: 2 }],
      perAccount: 1,
      priceMinor: 480_000,
      addons: Array.from({ length: LIVE_ADDONS_MAX }, (_, i) => ({ label: `ADD-ON ${i + 1}`, priceMinor: 1_000 * (i + 1) })),
    });
    clock.set(new Date(opensAt.getTime() - MINUTE));
    await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id, quantity: 1 }, a.actor);
    clock.set(opensAt);
    await f.live.advance(r.id);
    const token = (await f.live.entry(a.id, r.id))!.turn!.token!;
    await f.live.press(a.id, r.id, token);
    clock.advance(1500);
    await f.live.secure(a.id, r.id, token, a.actor);
    await f.live.setAddons(a.id, r.id, r.addons.map((x) => x.id), a.actor);
    await f.live.confirm(a.id, r.id, a.actor);
    const entry = await t.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', a.id).executeTakeFirstOrThrow();
    const order = await t.db.selectFrom('orders').selectAll().where('live_entry_id', '=', entry.id).where('channel', '=', 'LIVE').executeTakeFirstOrThrow();
    expect(await giftsOf(order.id)).toHaveLength(2);
    // € 150 of credit: PALLADIUM's € 100, then PLATINE's € 50.
    await orders().applyCredit(order.id, 15_000, admin);
    await pay(order.id);
    const invoice = await t.db.selectFrom('invoices').selectAll().where('order_id', '=', order.id).where('kind', '=', 'INVOICE').executeTakeFirstOrThrow();
    const lines = linesOf(invoice.lines);
    expect(lines.map((l) => l.kind)).toEqual(['PIECE', ...Array(LIVE_ADDONS_MAX).fill('ADDON'), 'SHIPPING', 'CREDIT', 'CREDIT', 'GIFT', 'GIFT']);
    expect(lines).toHaveLength(INVOICE_MAX_LINES);
    expect(lines.filter((l) => l.kind === 'CREDIT').map((l) => [l.label, l.amountMinor])).toEqual([
      ['CREDIT · PALLADIUM', -10_000],
      ['CREDIT · PLATINE', -5_000],
    ]);
    // Its PDF, as the console and MY PIECES serve it.
    const pdf = await ctx.services.invoices.pdf(invoice.id);
    expect(pdf.contentType).toBe('application/pdf');
    expect(Buffer.from(pdf.body).subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect((await ctx.services.invoices.accountDocument(a.id, order.id, 'INVOICE')).body.length).toBeGreaterThan(0);
    await setGift(2, null);
    await setGift(3, null);
  });
});
