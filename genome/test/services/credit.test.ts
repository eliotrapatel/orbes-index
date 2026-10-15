/**
 * The tiers' credit taken off an order (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T5, step 2.5; migration 0027), on the
 * services as createContext wires them:
 *
 *  - APPLY CREDIT on a RESERVED order, priced, of a channel THE PROGRAM names, in the credit's currency, within the
 *    balance and the piece's price; PALLADIUM's grant first, split over several when one does not cover it;
 *  - refused: none (no grant, expired, waiting below its tier: ORDER_CREDIT_NONE), another currency
 *    (ORDER_CREDIT_CURRENCY), a channel left out or a welcome gift (ORDER_CREDIT_CHANNEL), too much
 *    (ORDER_CREDIT_EXCEEDS), past RESERVED (ORDER_CLOSED);
 *  - the invoice's CREDIT lines (negative, per tier) and its total less them; the credit note mirrors it;
 *  - given back by REMOVE CREDIT, a cancellation and a return, the grant's expiry unchanged; audited;
 *  - two applications at once never take more than the balance;
 *  - the birthday credit (plan CUSTOMER INTELLIGENCE §3.5 SB.4.3, step 6.3; the plan's orders.test and gift-orders.test
 *    cases, here with the other cases of Apply credit): taken whatever the tier, a collector without a piece included,
 *    first (before PALLADIUM's and PLATINE's), split with them, refused on a channel left out, in another currency and
 *    once expired; CREDIT · BIRTHDAY first on the invoice; given back on a cancellation and a return, its expiry unchanged;
 *  - the warranty credit (plan ORBES CARE, step 1.5; kind WARRANTY): taken whatever the tier, a collector without a
 *    piece included, after the birthday credit and before PALLADIUM's and PLATINE's, split with them, in its own
 *    currency only; CREDIT · WARRANTY on the invoice after CREDIT · BIRTHDAY; given back on a cancellation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inTransaction } from '../../src/server/db/connection.js';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { linesOf } from '../../src/server/services/invoices.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { birthdayExpiry } from '../../src/server/services/birthday-credits.js';
import { parisDay } from '../../src/server/services/schedule.js';
import { addUtcMonths, creditBalances } from '../../src/server/services/tier-grants.js';
import { poolDraw } from '../support/draws.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { packAndShip, stockPieces } from '../support/fulfil.js';
import { createAccount, holdPieces, liveFixtureOn, type LiveFixture } from '../support/live.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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

describe('the tiers\' credit (BP-19 T5)', () => {
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
  const usesOf = (orderId: string) =>
    t.db.selectFrom('credit_uses as u').innerJoin('tier_grants as g', 'g.id', 'u.grant_id').select(['g.tier', 'u.amount_minor', 'u.released_reason']).where('u.order_id', '=', orderId).orderBy('u.applied_at').orderBy('g.tier', 'desc').execute();
  const auditsOf = (id: string, action: string) => t.db.selectFrom('audit_logs').select(['details']).where('target_id', '=', id).where('action', '=', action).orderBy('id').execute();
  const pay = (id: string) => {
    clock.advance(MINUTE);
    return orders().transition(id, { to: 'PAID' }, admin);
  };
  /** An account of `pieces` pieces with its grants made (5 PLATINE, 10 PALLADIUM). */
  const account = async (pieces: number) => {
    const a = await createAccount(t.db);
    await holdPieces(t.db, a.id, pieces, f.modelId);
    await ctx.services.tierGrants.ensure(a.id);
    return a;
  };
  /** A private salon's order closed as ACCEPTED, priced when `priceMinor` is given. */
  async function salonOrder(accountId: string, o: { priceMinor?: number; currency?: 'EUR' | 'GBP'; size?: string } = {}) {
    const request = await t.db.insertInto('shop_requests').values({ account_id: accountId, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
    clock.advance(MINUTE);
    await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, admin);
    const id = (await t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).where('channel', '=', 'SALON').executeTakeFirstOrThrow()).id;
    if (o.priceMinor !== undefined) await orders().setTerms(id, { sizeLabel: o.size ?? '58', priceMinor: o.priceMinor, currency: o.currency ?? 'EUR' }, admin);
    return id;
  }

  it('takes PLATINE\'s credit off a priced RESERVED order, within its balance and the price; its invoice carries the CREDIT line', async () => {
    const a = await account(5);
    const id = await salonOrder(a.id, { priceMinor: 300_000 });
    const view = await orders().applyCredit(id, 3_000, admin);
    expect(view.credit.applied.map((u) => [u.tier, u.amountMinor, u.releasedAt])).toEqual([[2, 3_000, null]]);
    expect(view.credit.available.map((c) => [c.tier, c.balanceMinor, c.currency])).toEqual([[2, 2_000, 'EUR']]);
    expect((await auditsOf(id, 'order.credit.apply'))[0]!.details).toMatchObject({ amountMinor: 3_000, currency: 'EUR' });
    // More than what is left: refused; the rest: taken, one use per grant and order.
    await rejects(orders().applyCredit(id, 2_001, admin), 'ORDER_CREDIT_EXCEEDS');
    await orders().applyCredit(id, 2_000, admin);
    expect((await usesOf(id)).map((u) => [u.amount_minor, u.released_reason]).sort((x, y) => x[0]! < y[0]! ? -1 : 1)).toEqual([
      [3_000, 'REMOVED'],
      [5_000, null],
    ]);
    await rejects(orders().applyCredit(id, 1, admin), 'ORDER_CREDIT_NONE');
    await pay(id);
    const invoice = await t.db.selectFrom('invoices').selectAll().where('order_id', '=', id).executeTakeFirstOrThrow();
    const credit = linesOf(invoice.lines).filter((l) => l.kind === 'CREDIT');
    expect(credit).toEqual([{ kind: 'CREDIT', label: 'CREDIT · PLATINE', detail: null, amountMinor: -5_000 }]);
    expect(invoice.total_minor).toBe(295_000);
    // Paid: closed to the credit.
    await rejects(orders().applyCredit(id, 1, admin), 'ORDER_CLOSED');
    await rejects(orders().removeCredit(id, admin), 'ORDER_CLOSED');
  });

  it('refuses another currency, a channel left out, a welcome gift, a price above it, an unpriced order, none at all', async () => {
    const a = await account(5);
    await rejects(orders().applyCredit(await salonOrder(a.id, { priceMinor: 300_000, currency: 'GBP' }), 1_000, admin), 'ORDER_CREDIT_CURRENCY');
    // Within the piece's price.
    await rejects(orders().applyCredit(await salonOrder(a.id, { priceMinor: 4_000 }), 4_001, admin), 'ORDER_CREDIT_EXCEEDS');
    await rejects(orders().applyCredit(await salonOrder(a.id), 1_000, admin), 'VALIDATION_FAILED');
    // THE PROGRAM's channels: SALON left out.
    const program = ctx.services.clubProgram;
    await program.update({ ...(await program.read()), creditChannels: ['DRAW', 'LIVE'] }, admin);
    await rejects(orders().applyCredit(await salonOrder(a.id, { priceMinor: 300_000 }), 1_000, admin), 'ORDER_CREDIT_CHANNEL');
    await t.db.deleteFrom('club_program_settings').execute();
    // A welcome gift's order.
    const ring = (await t.db.insertInto('models').values({ category_id: 1, name: 'CREDIT GIFT', type: 'RING', sku_prefix: 'CRG' }).returning('id').executeTakeFirstOrThrow()).id;
    await program.update({ ...(await program.read()), giftPlatineModelId: ring }, admin);
    const b = await account(5);
    const parent = await salonOrder(b.id, { priceMinor: 300_000 });
    const gift = (await t.db.selectFrom('orders').select('id').where('with_order_id', '=', parent).where('channel', '=', 'GIFT').executeTakeFirstOrThrow()).id;
    await rejects(orders().applyCredit(gift, 1_000, admin), 'ORDER_CREDIT_CHANNEL');
    await t.db.deleteFrom('club_program_settings').execute();
    // Below PLATINE: none.
    const titane = await account(1);
    await rejects(orders().applyCredit(await salonOrder(titane.id, { priceMinor: 300_000 }), 1_000, admin), 'ORDER_CREDIT_NONE');
  });

  it('takes PALLADIUM\'s first, then PLATINE\'s; refuses an expired credit and one waiting below its tier', async () => {
    const a = await account(10);
    const id = await salonOrder(a.id, { priceMinor: 300_000 });
    await orders().applyCredit(id, 12_000, admin);
    expect((await usesOf(id)).map((u) => [u.tier, u.amount_minor])).toEqual([
      [3, 10_000],
      [2, 2_000],
    ]);
    const invoiceLines = async () => {
      await pay(id);
      return linesOf((await t.db.selectFrom('invoices').selectAll().where('order_id', '=', id).executeTakeFirstOrThrow()).lines).filter((l) => l.kind === 'CREDIT');
    };
    expect((await invoiceLines()).map((l) => [l.label, l.amountMinor])).toEqual([
      ['CREDIT · PALLADIUM', -10_000],
      ['CREDIT · PLATINE', -2_000],
    ]);
    // Below PALLADIUM now: its grant waits; PLATINE's is what is left.
    const b = await account(10);
    const held = await t.db.selectFrom('ownership').select('id').where('account_id', '=', b.id).where('ended_at', 'is', null).limit(1).executeTakeFirstOrThrow();
    await t.db.updateTable('ownership').set({ ended_at: clock.now(), ended_reason: 'TRANSFERRED_OUT' }).where('id', '=', held.id).execute();
    const view = await orders().get(await salonOrder(b.id, { priceMinor: 300_000 }));
    expect(view.credit.available.map((c) => c.tier)).toEqual([2]);
    // Thirteen months on: expired.
    const c = await account(5);
    const late = await salonOrder(c.id, { priceMinor: 300_000 });
    clock.advance(13 * 31 * DAY);
    await rejects(orders().applyCredit(late, 1_000, admin), 'ORDER_CREDIT_NONE');
  });

  it('gives it back on REMOVE CREDIT, a cancellation (after PAID, the credit note mirrors the invoice) and a return, the expiry unchanged', async () => {
    const a = await account(5);
    const [before] = await creditBalances(t.db, a.id);
    // REMOVE CREDIT.
    const removed = await salonOrder(a.id, { priceMinor: 300_000 });
    await orders().applyCredit(removed, 5_000, admin);
    await orders().removeCredit(removed, admin);
    expect((await usesOf(removed)).map((u) => u.released_reason)).toEqual(['REMOVED']);
    await rejects(orders().removeCredit(removed, admin), 'ORDER_CREDIT_NONE');
    expect((await auditsOf(removed, 'order.credit.remove'))[0]!.details).toMatchObject({ reason: 'REMOVED', amountMinor: 5_000 });
    // Cancelled after PAID: given back, and the credit note cancels the invoice whole.
    const cancelled = await salonOrder(a.id, { priceMinor: 300_000 });
    await orders().applyCredit(cancelled, 5_000, admin);
    await pay(cancelled);
    clock.advance(MINUTE);
    await orders().transition(cancelled, { to: 'CANCELLED', note: 'The client changed their mind.' }, admin);
    expect((await usesOf(cancelled)).map((u) => u.released_reason)).toEqual(['CANCELLED']);
    const docs = await t.db.selectFrom('invoices').select(['kind', 'total_minor', 'lines']).where('order_id', '=', cancelled).orderBy('issued_at').execute();
    expect(docs.map((d) => [d.kind, d.total_minor, linesOf(d.lines).map((l) => [l.kind, l.amountMinor])])).toEqual([
      ['INVOICE', 295_000, [['PIECE', 300_000], ['SHIPPING', 0], ['CREDIT', -5_000]]],
      ['CREDIT_NOTE', 295_000, [['PIECE', 300_000], ['SHIPPING', 0], ['CREDIT', -5_000]]],
    ]);
    // Returned: given back.
    const sku = await inTransaction(t.db, (tx) => ensureSku(tx, f.modelId, '62'));
    await stockPieces(ctx, { skuId: sku, locationId: france, count: 1, material: '925 STERLING SILVER' }, admin);
    const returned = await salonOrder(a.id, { priceMinor: 300_000, size: '62' });
    await orders().applyCredit(returned, 5_000, admin);
    await pay(returned);
    clock.advance(MINUTE);
    await packAndShip(ctx, returned, { carrierId: colissimo, trackingNumber: '6A12345678901' }, admin);
    clock.advance(MINUTE);
    await orders().returnOrder(returned, { outcome: 'RESTOCKED', locationId: france, note: 'Returned unworn.' }, admin);
    expect((await usesOf(returned)).map((u) => u.released_reason)).toEqual(['RETURNED']);
    expect((await auditsOf(returned, 'order.credit.release'))[0]!.details).toMatchObject({ reason: 'RETURNED', amountMinor: 5_000 });
    // Whole again, the expiry unchanged.
    expect((await creditBalances(t.db, a.id))[0]).toEqual(before);
  });

  it('never takes more than the balance when two orders apply it at once', async () => {
    const a = await account(5);
    const one = await salonOrder(a.id, { priceMinor: 300_000 });
    const two = await salonOrder(a.id, { priceMinor: 300_000 });
    const results = await Promise.allSettled([orders().applyCredit(one, 5_000, admin), orders().applyCredit(two, 5_000, admin)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((refused.reason as DomainError).code).toMatch(/^ORDER_CREDIT_(EXCEEDS|NONE)$/);
    expect((await creditBalances(t.db, a.id))[0]!.balanceMinor).toBe(0);
  });

  // ── The birthday credit (plan CUSTOMER INTELLIGENCE §3.5 SB.4.3) ─────────

  /** A birthday credit as the daily grant gives it (step 6.4): no tier, today's birthday (Paris), € 20 for 30 days by default. */
  async function birthdayGrant(accountId: string, o: { amountMinor?: number; currency?: string; on?: string } = {}) {
    const on = o.on ?? parisDay(clock.now());
    return (
      await t.db
        .insertInto('tier_grants')
        .values({ account_id: accountId, tier: null, kind: 'BIRTHDAY', granted_at: clock.now(), amount_minor: o.amountMinor ?? 2_000, currency: o.currency ?? 'EUR', expires_at: birthdayExpiry(on, 30), birthday_on: on })
        .returning(['id', 'expires_at'])
        .executeTakeFirstOrThrow()
    );
  }
  /** An order's credit uses, the birthday credit's first, then by tier (taken at one instant, their ids say nothing of the order). */
  const birthdayUsesOf = async (orderId: string) =>
    (
      await t.db
        .selectFrom('credit_uses as u')
        .innerJoin('tier_grants as g', 'g.id', 'u.grant_id')
        .select(['g.kind', 'g.tier', 'u.amount_minor', 'u.released_reason'])
        .where('u.order_id', '=', orderId)
        .execute()
    ).sort((x, y) => (x.kind === 'BIRTHDAY' ? -1 : y.kind === 'BIRTHDAY' ? 1 : (y.tier ?? 0) - (x.tier ?? 0)));
  const creditLines = async (orderId: string) =>
    linesOf((await t.db.selectFrom('invoices').selectAll().where('order_id', '=', orderId).where('kind', '=', 'INVOICE').executeTakeFirstOrThrow()).lines)
      .filter((l) => l.kind === 'CREDIT')
      .map((l) => [l.label, l.amountMinor]);
  /** A draw's order won by `account`, priced. */
  async function drawOrder(account: { id: string; actor: Actor }, priceMinor: number) {
    const opensAt = new Date(clock.now().getTime() + HOUR);
    const drop = await poolDraw(
      ctx.services.drops,
      ctx.db,
      { modelId: f.modelId, title: 'A BIRTHDAY DRAW', quantity: 1, opensAt, closesAt: new Date(opensAt.getTime() + HOUR), earlyAccessHours: 0, earlyAccessPlatineHours: 0, priceMinor, currency: 'EUR' },
      admin,
    );
    clock.set(new Date(opensAt.getTime() + MINUTE));
    await ctx.services.drops.enter(account.id, drop.id, account.actor);
    clock.advance(HOUR);
    await ctx.services.drops.draw(drop.id, admin);
    const entry = await t.db.selectFrom('drop_entries').select('id').where('drop_id', '=', drop.id).executeTakeFirstOrThrow();
    await ctx.services.drops.confirm(drop.id, entry.id, null, admin);
    return (await t.db.selectFrom('orders').select('id').where('drop_entry_id', '=', entry.id).where('channel', '=', 'DRAW').executeTakeFirstOrThrow()).id;
  }

  it('takes the birthday credit off the draw order of a collector without a piece: offered whatever the tier, CREDIT · BIRTHDAY on the invoice, audited with its kind', async () => {
    const a = await createAccount(t.db);
    // No piece, no tier: without a birthday credit, none.
    const none = await drawOrder(a, 300_000);
    await rejects(orders().applyCredit(none, 1_000, admin), 'ORDER_CREDIT_NONE');
    const grant = await birthdayGrant(a.id);
    const id = await drawOrder(a, 300_000);
    expect((await orders().get(id)).credit.available).toEqual([{ grantId: grant.id, kind: 'BIRTHDAY', tier: null, balanceMinor: 2_000, currency: 'EUR', expiresAt: grant.expires_at }]);
    const view = await orders().applyCredit(id, 2_000, admin);
    expect(view.credit.applied.map((u) => [u.kind, u.tier, u.amountMinor, u.releasedAt])).toEqual([['BIRTHDAY', null, 2_000, null]]);
    expect(view.credit.available).toEqual([]);
    expect((await auditsOf(id, 'order.credit.apply'))[0]!.details).toMatchObject({ amountMinor: 2_000, currency: 'EUR', uses: [{ grantId: grant.id, kind: 'BIRTHDAY', tier: null, amountMinor: 2_000 }] });
    await pay(id);
    expect(await creditLines(id)).toEqual([['CREDIT · BIRTHDAY', -2_000]]);
    expect((await t.db.selectFrom('invoices').select('total_minor').where('order_id', '=', id).where('kind', '=', 'INVOICE').executeTakeFirstOrThrow()).total_minor).toBe(298_000);
  });

  it('takes the birthday credit first, then PALLADIUM\'s, then PLATINE\'s, split over them; CREDIT · BIRTHDAY first on the invoice', async () => {
    const a = await account(10);
    await birthdayGrant(a.id);
    const id = await salonOrder(a.id, { priceMinor: 300_000 });
    expect((await orders().get(id)).credit.available.map((c) => [c.kind, c.tier, c.balanceMinor])).toEqual([
      ['BIRTHDAY', null, 2_000],
      ['CREDIT', 3, 10_000],
      ['CREDIT', 2, 5_000],
    ]);
    // € 130: the birthday's € 20, PALLADIUM's € 100, then € 10 of PLATINE's.
    await orders().applyCredit(id, 13_000, admin);
    expect((await birthdayUsesOf(id)).map((u) => [u.kind, u.tier, u.amount_minor])).toEqual([
      ['BIRTHDAY', null, 2_000],
      ['CREDIT', 3, 10_000],
      ['CREDIT', 2, 1_000],
    ]);
    expect((await creditBalances(t.db, a.id)).map((c) => [c.kind, c.tier, c.birthdayOn, c.balanceMinor])).toEqual([
      ['BIRTHDAY', null, parisDay(clock.now()), 0],
      ['CREDIT', 3, null, 0],
      ['CREDIT', 2, null, 4_000],
    ]);
    await pay(id);
    expect(await creditLines(id)).toEqual([
      ['CREDIT · BIRTHDAY', -2_000],
      ['CREDIT · PALLADIUM', -10_000],
      ['CREDIT · PLATINE', -1_000],
    ]);
  });

  it('refuses the birthday credit on a channel THE PROGRAM leaves out, in another currency, and once expired', async () => {
    const a = await createAccount(t.db);
    await birthdayGrant(a.id);
    const program = ctx.services.clubProgram;
    await program.update({ ...(await program.read()), creditChannels: ['DRAW', 'LIVE'] }, admin);
    await rejects(orders().applyCredit(await salonOrder(a.id, { priceMinor: 300_000 }), 1_000, admin), 'ORDER_CREDIT_CHANNEL');
    await t.db.deleteFrom('club_program_settings').execute();
    await rejects(orders().applyCredit(await salonOrder(a.id, { priceMinor: 300_000, currency: 'GBP' }), 1_000, admin), 'ORDER_CREDIT_CURRENCY');
    // Day 30 is its last; day 31, gone.
    const b = await createAccount(t.db);
    await birthdayGrant(b.id);
    const late = await salonOrder(b.id, { priceMinor: 300_000 });
    clock.advance(31 * DAY);
    await rejects(orders().applyCredit(late, 1_000, admin), 'ORDER_CREDIT_NONE');
  });

  it('gives the birthday credit back on a cancellation and a return, its expiry unchanged', async () => {
    const a = await createAccount(t.db);
    await birthdayGrant(a.id);
    const [before] = await creditBalances(t.db, a.id);
    const cancelled = await salonOrder(a.id, { priceMinor: 300_000 });
    await orders().applyCredit(cancelled, 2_000, admin);
    clock.advance(MINUTE);
    await orders().transition(cancelled, { to: 'CANCELLED', note: 'The client changed their mind.' }, admin);
    expect((await birthdayUsesOf(cancelled)).map((u) => [u.kind, u.released_reason])).toEqual([['BIRTHDAY', 'CANCELLED']]);
    expect((await creditBalances(t.db, a.id))[0]).toEqual(before);
    const sku = await inTransaction(t.db, (tx) => ensureSku(tx, f.modelId, '64'));
    await stockPieces(ctx, { skuId: sku, locationId: france, count: 1, material: '925 STERLING SILVER' }, admin);
    const returned = await salonOrder(a.id, { priceMinor: 300_000, size: '64' });
    await orders().applyCredit(returned, 2_000, admin);
    await pay(returned);
    clock.advance(MINUTE);
    await packAndShip(ctx, returned, { carrierId: colissimo, trackingNumber: '6A12345678902' }, admin);
    clock.advance(MINUTE);
    await orders().returnOrder(returned, { outcome: 'RESTOCKED', locationId: france, note: 'Returned unworn.' }, admin);
    expect((await birthdayUsesOf(returned)).map((u) => [u.kind, u.released_reason])).toEqual([['BIRTHDAY', 'RETURNED']]);
    expect((await creditBalances(t.db, a.id))[0]).toEqual(before);
  });
  // ── The warranty credit (plan ORBES CARE, step 1.5) ──────────────────────

  /** A warranty credit as a claim's decision gives it: no tier, no birthday, valid 12 months, in the value's currency. */
  async function warrantyGrant(accountId: string, o: { amountMinor?: number; currency?: string } = {}) {
    return t.db
      .insertInto('tier_grants')
      .values({ account_id: accountId, tier: null, kind: 'WARRANTY', granted_at: clock.now(), amount_minor: o.amountMinor ?? 13_500, currency: o.currency ?? 'EUR', expires_at: addUtcMonths(clock.now(), 12) })
      .returning(['id', 'expires_at'])
      .executeTakeFirstOrThrow();
  }
  /** An order's credit uses in the order they are taken: the birthday credit, the warranty credit, then by tier. */
  const usesInOrder = async (orderId: string) => {
    const rank = (k: string) => (k === 'BIRTHDAY' ? 0 : k === 'WARRANTY' ? 1 : 2);
    return (
      await t.db
        .selectFrom('credit_uses as u')
        .innerJoin('tier_grants as g', 'g.id', 'u.grant_id')
        .select(['g.kind', 'g.tier', 'u.amount_minor', 'u.released_reason'])
        .where('u.order_id', '=', orderId)
        .execute()
    ).sort((x, y) => rank(x.kind) - rank(y.kind) || (y.tier ?? 0) - (x.tier ?? 0));
  };

  it('takes the warranty credit off the draw order of a collector without a piece: offered whatever the tier, CREDIT · WARRANTY on the invoice, audited with its kind', async () => {
    const a = await createAccount(t.db);
    const grant = await warrantyGrant(a.id);
    const id = await drawOrder(a, 300_000);
    expect((await orders().get(id)).credit.available).toEqual([{ grantId: grant.id, kind: 'WARRANTY', tier: null, balanceMinor: 13_500, currency: 'EUR', expiresAt: grant.expires_at }]);
    const view = await orders().applyCredit(id, 13_500, admin);
    expect(view.credit.applied.map((u) => [u.kind, u.tier, u.amountMinor, u.releasedAt])).toEqual([['WARRANTY', null, 13_500, null]]);
    expect((await auditsOf(id, 'order.credit.apply'))[0]!.details).toMatchObject({ amountMinor: 13_500, currency: 'EUR', uses: [{ grantId: grant.id, kind: 'WARRANTY', tier: null, amountMinor: 13_500 }] });
    await pay(id);
    expect(await creditLines(id)).toEqual([['CREDIT · WARRANTY', -13_500]]);
    expect((await t.db.selectFrom('invoices').select('total_minor').where('order_id', '=', id).where('kind', '=', 'INVOICE').executeTakeFirstOrThrow()).total_minor).toBe(286_500);
  });

  it('takes the birthday credit, then the warranty credit, then PALLADIUM\'s, then PLATINE\'s, split over them; CREDIT · WARRANTY after CREDIT · BIRTHDAY on the invoice', async () => {
    const a = await account(10);
    await birthdayGrant(a.id);
    await warrantyGrant(a.id, { amountMinor: 3_000 });
    const id = await salonOrder(a.id, { priceMinor: 300_000 });
    expect((await orders().get(id)).credit.available.map((c) => [c.kind, c.tier, c.balanceMinor])).toEqual([
      ['BIRTHDAY', null, 2_000],
      ['WARRANTY', null, 3_000],
      ['CREDIT', 3, 10_000],
      ['CREDIT', 2, 5_000],
    ]);
    // € 160: the birthday's € 20, the warranty's € 30, PALLADIUM's € 100, then € 10 of PLATINE's.
    await orders().applyCredit(id, 16_000, admin);
    expect((await usesInOrder(id)).map((u) => [u.kind, u.tier, u.amount_minor])).toEqual([
      ['BIRTHDAY', null, 2_000],
      ['WARRANTY', null, 3_000],
      ['CREDIT', 3, 10_000],
      ['CREDIT', 2, 1_000],
    ]);
    await pay(id);
    expect(await creditLines(id)).toEqual([
      ['CREDIT · BIRTHDAY', -2_000],
      ['CREDIT · WARRANTY', -3_000],
      ['CREDIT · PALLADIUM', -10_000],
      ['CREDIT · PLATINE', -1_000],
    ]);
  });

  it('takes a warranty credit only off an order of its own currency, and gives it back on a cancellation, its expiry unchanged', async () => {
    const a = await createAccount(t.db);
    await warrantyGrant(a.id, { amountMinor: 9_000, currency: 'GBP' });
    await rejects(orders().applyCredit(await salonOrder(a.id, { priceMinor: 300_000 }), 1_000, admin), 'ORDER_CREDIT_CURRENCY');
    const [before] = await creditBalances(t.db, a.id);
    const gbp = await salonOrder(a.id, { priceMinor: 300_000, currency: 'GBP' });
    await orders().applyCredit(gbp, 9_000, admin);
    expect((await creditBalances(t.db, a.id))[0]!.balanceMinor).toBe(0);
    clock.advance(MINUTE);
    await orders().transition(gbp, { to: 'CANCELLED', note: 'The client changed their mind.' }, admin);
    expect((await usesInOrder(gbp)).map((u) => [u.kind, u.released_reason])).toEqual([['WARRANTY', 'CANCELLED']]);
    expect((await creditBalances(t.db, a.id))[0]).toEqual(before);
  });
});
