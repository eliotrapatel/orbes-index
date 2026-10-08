/**
 * An order's delivery address (plan NEXT LOT of 2026-10-07, §3.6.B and §1.1 (d), step 6.7; services/orders.ts), on the
 * services as createContext wires them:
 *
 *  - a new order of its own takes the account's default address at its creation (the collector's); a welcome gift, an
 *    order travelling with another and a size exchange never do;
 *  - the collector sets it from a saved address or a new one (saved to YOUR ADDRESSES when asked), RESERVED or PAID,
 *    until packing starts (409 ORDER_PACKING_STARTED), never on an order travelling with another (409
 *    ORDER_TRAVELS_WITH) nor once shipped or cancelled (409 ORDER_CLOSED); the first address sets when, any later one
 *    the change mark; the same address again changes nothing; a LOCKED account changes nothing;
 *  - Client Services sets the country and the phone too, until SHIPPED, packing started or not, with the change mark;
 *    never on a travelling order, a welcome gift included; a cancelled order that still keys a parcel stays editable;
 *  - `addressOf`: a travelling order reads its parent's address, in YOUR ORDERS, on the console's order and on its invoice;
 *  - the invoice's buyer adds the country's English name; an invoice issued before an address change keeps its buyer;
 *  - `order.address` and `order.buyer` are audited with the country and who, never the words;
 *  - exported to the account with its country and phone.
 *
 * And its engraving (plan NEXT LOT §3.6.C, step 6.8):
 *  - the prices per currency in Orders → Settings (ADMIN), audited before and after; a currency without a price offers no
 *    engraving, nor does a welcome gift, nor an order whose currency is not entered yet;
 *  - the collector adds, changes and removes it until packing starts, RESERVED or PAID; the words checked (20 characters
 *    at most); the price taken kept when the setting changes; after PAID a supplementary invoice or a credit note for its
 *    line, a free one or its words changed issuing nothing; never the words in the audit log, the events nor the journal;
 *  - an order whose release sold the engraving as an add-on (its label holds ENGRAVING): its words only, no second
 *    price, never removed by the collector (409 ORDER_ENGRAVING_INCLUDED); an add-on labelled otherwise offers nothing;
 *  - Client Services' words take the same price; a currency changed reprices or removes a priced engraving, a price and currency cleared remove it;
 *  - a LOCKED account changes nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { addressOf, orderReference } from '../../src/server/services/orders.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { inTransaction } from '../../src/server/db/connection.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { packAndShip, stockPieces } from '../support/fulfil.js';
import { createAccount, createLiveRelease, createModel, holdPieces, liveFixtureOn, type LiveFixture } from '../support/live.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

async function refusal(p: Promise<unknown>): Promise<{ code: string; status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, status: e.httpStatus, message: e.publicMessage };
    throw e;
  }
  throw new Error('expected a refusal');
}

const PARIS = { name: 'Jane Doe', address: '1 rue de la Paix\n75002 Paris', country: 'FR', phone: '+33 6 12 34 56 78' };
const LONDON = { name: 'Jane Doe', address: '22 Kensington Church Street\nLondon W8 4EP', country: 'GB', phone: '+44 20 7946 0000' };
const GENEVA = { name: 'Jane Doe', address: '3 quai du Mont-Blanc\n1201 Genève', country: 'CH', phone: '+41 79 123 45 67' };

describe('an order\'s delivery address (plan NEXT LOT §3.6.B)', () => {
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
  const row = (id: string) => t.db.selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const pay = (id: string) => {
    clock.advance(MINUTE);
    return orders().transition(id, { to: 'PAID' }, admin);
  };
  const skuOf = (label: string) => inTransaction(t.db, (tx) => ensureSku(tx, f.modelId, label));

  /** A private salon's order closed as ACCEPTED for the account, priced in size 58. */
  async function salonOrder(accountId: string, size = '58'): Promise<string> {
    const request = await t.db.insertInto('shop_requests').values({ account_id: accountId, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
    clock.advance(MINUTE);
    await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, admin);
    const id = (await t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).where('channel', '=', 'SALON').executeTakeFirstOrThrow()).id;
    await orders().setTerms(id, { sizeLabel: size, priceMinor: 420_000, currency: 'EUR' }, admin);
    return id;
  }

  /** A LIVE sale of `quantity` pieces for the account: its orders by piece (the first keys the parcel, the others travel with it); the add-ons bought when given. */
  async function liveSale(account: { id: string; actor: Actor }, quantity: number, addons: { label: string; priceMinor: number }[] = []): Promise<string[]> {
    const opensAt = new Date(clock.now().getTime() + HOUR);
    const r = await createLiveRelease(f, { modelId: f.modelId, opensAt, sizes: [{ label: '52', stock: 5 }], perAccount: quantity, priceMinor: 480_000, ...(addons.length ? { addons } : {}) });
    clock.set(new Date(opensAt.getTime() - MINUTE));
    await f.live.enter(account.id, r.id, { sizeId: r.sizes[0]!.id, quantity }, account.actor);
    clock.set(opensAt);
    await f.live.advance(r.id);
    const token = (await f.live.entry(account.id, r.id))!.turn!.token!;
    await f.live.press(account.id, r.id, token);
    clock.advance(1500);
    await f.live.secure(account.id, r.id, token, account.actor);
    if (addons.length) await f.live.setAddons(account.id, r.id, r.addons.map((x) => x.id), account.actor);
    await f.live.confirm(account.id, r.id, account.actor);
    const entry = await t.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', account.id).executeTakeFirstOrThrow();
    return (await t.db.selectFrom('orders').select('id').where('live_entry_id', '=', entry.id).orderBy('piece').execute()).map((o) => o.id);
  }

  it('puts the account\'s default address on a new order of its own, the collector\'s; never on an order travelling with another nor on a welcome gift', async () => {
    const a = await createAccount(t.db);
    // No saved address: the order has none.
    const bare = await salonOrder(a.id);
    expect(await row(bare)).toMatchObject({ buyer_name: null, buyer_address: null, buyer_country: null, buyer_phone: null, address_by: null, address_at: null });
    await ctx.services.addresses.create(a.id, LONDON, a.actor);
    clock.advance(MINUTE);
    await ctx.services.addresses.create(a.id, { ...PARIS, isDefault: true }, a.actor);
    const salon = await salonOrder(a.id);
    const o = await row(salon);
    expect(o).toMatchObject({ buyer_name: PARIS.name, buyer_address: PARIS.address, buyer_country: 'FR', buyer_phone: PARIS.phone, address_by: 'COLLECTOR', address_at: o.reserved_at, address_changed_at: null });
    const created = await t.db.selectFrom('order_events').select('details').where('order_id', '=', salon).where('action', '=', 'order.create').executeTakeFirstOrThrow();
    expect(created.details).toMatchObject({ address: { by: 'collector', country: 'FR' } });
    // A LIVE sale of two pieces: the first takes it, the second travels with it and carries none of its own.
    const [first, second] = await liveSale(a, 2);
    expect(await row(first!)).toMatchObject({ buyer_country: 'FR', address_by: 'COLLECTOR' });
    expect(await row(second!)).toMatchObject({ with_order_id: first, buyer_name: null, buyer_country: null, address_by: null });
    // A welcome gift (PLATINE, a gift model): travels with its order, none of its own.
    const gift = await createModel(t.db, 'GIFT RING');
    await inTransaction(t.db, (tx) => ensureSku(tx, gift, null));
    const program = await ctx.services.clubProgram.read();
    await ctx.services.clubProgram.update({ ...program, giftPlatineModelId: gift }, admin);
    const platine = await createAccount(t.db);
    await holdPieces(t.db, platine.id, 5, f.modelId);
    await ctx.services.addresses.create(platine.id, GENEVA, platine.actor);
    const parent = await salonOrder(platine.id);
    const giftOrder = (await t.db.selectFrom('orders').selectAll().where('with_order_id', '=', parent).where('channel', '=', 'GIFT').executeTakeFirstOrThrow());
    expect(await row(parent)).toMatchObject({ buyer_country: 'CH', address_by: 'COLLECTOR' });
    expect(giftOrder).toMatchObject({ buyer_name: null, buyer_country: null, address_by: null });
    // The gift is delivered with its order, to its address (`addressOf`).
    expect(await addressOf(t.db, giftOrder)).toMatchObject({ name: GENEVA.name, address: GENEVA.address, country: 'CH', phone: GENEVA.phone, by: 'COLLECTOR', travelsWith: parent });
    await ctx.services.clubProgram.update({ ...program, giftPlatineModelId: null }, admin);
  });

  it('lets the collector set it from a saved address or a new one, until packing starts; the change mark from the second; never another account\'s, a travelling order\'s, nor once closed', async () => {
    const a = await createAccount(t.db);
    const other = await createAccount(t.db);
    const saved = (await ctx.services.addresses.create(a.id, LONDON, a.actor)).addresses[0]!;
    const theirs = (await ctx.services.addresses.create(other.id, PARIS, other.actor)).addresses[0]!;
    // Created with the default (LONDON); the collector picks a new one, saved to its addresses.
    const id = await salonOrder(a.id, '60');
    const at = (await row(id)).address_at!;
    clock.advance(MINUTE);
    const changed = await orders().setAddress(a.id, id, { address: PARIS, save: true }, a.actor);
    expect(changed).toMatchObject({ id, address: { name: PARIS.name, lines: PARIS.address, country: 'FR', phone: PARIS.phone }, addressOf: null, editable: { address: true } });
    expect(await row(id)).toMatchObject({ buyer_country: 'FR', address_by: 'COLLECTOR', address_at: at, address_changed_at: clock.now() });
    expect((await ctx.services.addresses.list(a.id)).addresses.map((x) => [x.country, x.isDefault])).toEqual([['GB', true], ['FR', false]]);
    // The same again: nothing changes, no event.
    const events = async () => (await t.db.selectFrom('order_events').select('action').where('order_id', '=', id).where('action', '=', 'order.address').execute()).length;
    const n = await events();
    clock.advance(MINUTE);
    await orders().setAddress(a.id, id, { address: PARIS }, a.actor);
    expect(await events()).toBe(n);
    // A saved address of its own; another account's: 404; another account's order: 404.
    clock.advance(MINUTE);
    expect((await orders().setAddress(a.id, id, { addressId: saved.id }, a.actor)).address).toMatchObject({ country: 'GB' });
    expect(await refusal(orders().setAddress(a.id, id, { addressId: theirs.id }, a.actor))).toEqual({ code: 'ADDRESS_NOT_FOUND', status: 404, message: 'Address not found.' });
    expect(await refusal(orders().setAddress(other.id, id, { address: PARIS }, other.actor))).toMatchObject({ code: 'ORDER_NOT_FOUND', status: 404 });
    // Every field required, in its own words; saving a sixth refused.
    expect(await refusal(orders().setAddress(a.id, id, { address: { ...PARIS, phone: '' } }, a.actor))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'Enter a phone number with its country code.' });
    expect(await refusal(orders().setAddress(a.id, id, { address: { ...PARIS, country: 'ZZ' } }, a.actor))).toMatchObject({ message: 'Choose a country.' });
    expect(await refusal(orders().setAddress(a.id, id, { address: { ...PARIS, name: '' } }, a.actor))).toMatchObject({ message: 'Enter the name and the address.' });
    for (let i = 0; i < 3; i++) await ctx.services.addresses.create(a.id, { ...GENEVA, name: `Jane ${i}` }, a.actor);
    expect(await refusal(orders().setAddress(a.id, id, { address: GENEVA, save: true }, a.actor))).toEqual({ code: 'ADDRESS_LIMIT', status: 409, message: 'You may keep up to 5 addresses.' });
    expect((await row(id)).buyer_country).toBe('GB');
    // Audited with the country and who, never the words.
    const audit = await t.db.selectFrom('audit_logs').select(['actor_type', 'details']).where('action', '=', 'order.address').where('target_id', '=', id).orderBy('id').execute();
    expect(audit.map((x) => [x.actor_type, x.details.by, x.details.country, x.details.changed])).toEqual([
      ['account', 'collector', 'FR', true],
      ['account', 'collector', 'GB', true],
    ]);
    const everything = JSON.stringify([
      await t.db.selectFrom('audit_logs').select('details').where('target_id', '=', id).execute(),
      await t.db.selectFrom('order_events').select(['note', 'details']).where('order_id', '=', id).execute(),
      await t.db.selectFrom('event_journal').select('payload').where('entity_id', '=', id).execute(),
    ]);
    for (const w of ['Jane', 'Paix', 'Kensington', '+33', '+44']) expect(everything, w).not.toContain(w);
    // Paid, then packing started: the collector no longer changes it.
    await pay(id);
    const [piece] = await stockPieces(ctx, { skuId: await skuOf('60'), locationId: france, count: 1, material: '925 STERLING SILVER', forOrderIds: [id] }, admin);
    void piece;
    clock.advance(MINUTE);
    expect((await orders().setAddress(a.id, id, { address: PARIS }, a.actor)).editable).toMatchObject({ address: true });
    await ctx.services.logistics.startPacking(id, admin, null);
    expect(await refusal(orders().setAddress(a.id, id, { address: LONDON }, a.actor))).toEqual({
      code: 'ORDER_PACKING_STARTED',
      status: 409,
      message: 'Packing has begun: write to ORBES Client Services to change this order.',
    });
    expect((await orders().accountOrder(a.id, id)).editable).toMatchObject({ address: false });
    // Client Services still does, with the change mark; once shipped, neither.
    clock.advance(MINUTE);
    const staff = await orders().setBuyer(id, { name: GENEVA.name, address: GENEVA.address, country: 'CH', phone: GENEVA.phone }, admin);
    expect(staff).toMatchObject({ buyer: { name: GENEVA.name, address: GENEVA.address, country: 'CH', phone: GENEVA.phone }, addressBy: 'STAFF', addressChangedAt: clock.now() });
    expect((await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'order.buyer').where('target_id', '=', id).executeTakeFirstOrThrow()).details).toMatchObject({ fields: ['address', 'country', 'phone'], changed: true, country: 'CH' });
    await packAndShip(ctx, id, { carrierId: colissimo, trackingNumber: '6A00000000101' }, admin);
    expect(await refusal(orders().setAddress(a.id, id, { address: PARIS }, a.actor))).toMatchObject({ code: 'ORDER_CLOSED', status: 409 });
    expect(await refusal(orders().setBuyer(id, { name: 'Someone', address: 'Elsewhere' }, admin))).toEqual({ code: 'ORDER_CLOSED', status: 409, message: 'This order can no longer change.' });
    // Its warranty started at SHIP in the delivery country (question 14 as built).
    const w = await t.db.selectFrom('warranties').select('country').where('product_id', '=', (await row(id)).product_id!).executeTakeFirstOrThrow();
    expect(w.country).toBe('CH');
    // Cancelled: no change either. A LOCKED account changes nothing.
    const cancelled = await salonOrder(a.id);
    clock.advance(MINUTE);
    await orders().transition(cancelled, { to: 'CANCELLED', note: 'The client withdrew.' }, admin);
    expect(await refusal(orders().setAddress(a.id, cancelled, { address: PARIS }, a.actor))).toMatchObject({ code: 'ORDER_CLOSED' });
    const open = await salonOrder(a.id);
    await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', a.id).execute();
    expect(await refusal(orders().setAddress(a.id, open, { address: PARIS }, a.actor))).toEqual({ code: 'ACCOUNT_LOCKED', status: 403, message: 'This account is locked. ORBES Client Services can assist you.' });
    await t.db.updateTable('accounts').set({ status: 'ACTIVE' }).where('id', '=', a.id).execute();
  });

  it('delivers an order travelling with another to that order\'s address: refused its own (the collector and Client Services, a welcome gift included), read from its parent in YOUR ORDERS, on the console and on its invoice; a cancelled parent still keying their parcel stays editable', async () => {
    const a = await createAccount(t.db);
    const [first, second] = await liveSale(a, 2);
    const travels = { code: 'ORDER_TRAVELS_WITH', status: 409, message: `This piece travels with order ${orderReference(first!)}: its address is that order’s.` };
    expect(await refusal(orders().setAddress(a.id, second!, { address: PARIS }, a.actor))).toEqual(travels);
    expect(await refusal(orders().setBuyer(second!, { name: 'Jane Doe', address: '1 rue de la Paix' }, admin))).toEqual(travels);
    await orders().setAddress(a.id, first!, { address: PARIS }, a.actor);
    // YOUR ORDERS: the parent's address, its reference, not editable.
    const mine = new Map((await orders().forAccount(a.id)).map((o) => [o.id, o]));
    expect(mine.get(second!)).toMatchObject({ address: { name: PARIS.name, lines: PARIS.address, country: 'FR', phone: PARIS.phone }, addressOf: orderReference(first!), editable: { address: false } });
    expect(mine.get(first!)).toMatchObject({ address: { country: 'FR' }, addressOf: null, editable: { address: true } });
    // The console's order: its parent's address and who entered it.
    expect(await orders().get(second!)).toMatchObject({ buyer: { name: PARIS.name, address: PARIS.address, country: 'FR', phone: PARIS.phone }, addressBy: 'COLLECTOR' });
    // Its invoice names its parent's buyer, with the country's English name.
    await pay(first!);
    await pay(second!);
    const invoice = (await ctx.services.invoices.list({ q: orderReference(second!) })).items.find((i) => i.order.id === second)!;
    expect(invoice.buyer).toEqual({ name: PARIS.name, address: PARIS.address, email: a.email, country: 'France' });
    // A welcome gift: Client Services cannot enter its own either.
    const gift = await createModel(t.db, 'GIFT CUFF');
    await inTransaction(t.db, (tx) => ensureSku(tx, gift, null));
    const program = await ctx.services.clubProgram.read();
    await ctx.services.clubProgram.update({ ...program, giftPlatineModelId: gift }, admin);
    const platine = await createAccount(t.db);
    await holdPieces(t.db, platine.id, 5, f.modelId);
    const parent = await salonOrder(platine.id);
    const giftId = (await t.db.selectFrom('orders').select('id').where('with_order_id', '=', parent).where('channel', '=', 'GIFT').executeTakeFirstOrThrow()).id;
    expect(await refusal(orders().setBuyer(giftId, { name: 'Jane Doe', address: '1 rue de la Paix' }, admin))).toMatchObject({ code: 'ORDER_TRAVELS_WITH' });
    await ctx.services.clubProgram.update({ ...program, giftPlatineModelId: null }, admin);
    // The parent cancelled, the follower still to ship: the parent keys their parcel, its address editable by Client
    // Services (not by the collector).
    const b = await createAccount(t.db);
    const [p1, p2] = await liveSale(b, 2);
    clock.advance(MINUTE);
    await orders().transition(p1!, { to: 'CANCELLED', note: 'The client kept one piece only.' }, admin);
    expect(await refusal(orders().setAddress(b.id, p1!, { address: PARIS }, b.actor))).toMatchObject({ code: 'ORDER_CLOSED' });
    expect((await orders().setBuyer(p1!, { name: GENEVA.name, address: GENEVA.address, country: 'CH' }, admin)).buyer).toMatchObject({ country: 'CH' });
    expect((await orders().forAccount(b.id)).find((o) => o.id === p2)).toMatchObject({ address: { country: 'CH' }, addressOf: orderReference(p1!) });
    clock.advance(MINUTE);
    await orders().transition(p2!, { to: 'CANCELLED', note: 'Test over.' }, admin);
    expect(await refusal(orders().setBuyer(p1!, { name: PARIS.name, address: PARIS.address }, admin))).toMatchObject({ code: 'ORDER_CLOSED' });
  });

  it('prints the country\'s English name on the invoice, which keeps its buyer when the address changes after PAID; exports the order\'s country and phone', async () => {
    const a = await createAccount(t.db);
    const id = await salonOrder(a.id);
    await orders().setAddress(a.id, id, { address: GENEVA }, a.actor);
    await pay(id);
    const doc = (await ctx.services.invoices.list({ q: orderReference(id) })).items.find((i) => i.kind === 'INVOICE')!;
    expect(doc.buyer).toEqual({ name: GENEVA.name, address: GENEVA.address, email: a.email, country: 'Switzerland' });
    clock.advance(MINUTE);
    await orders().setAddress(a.id, id, { address: PARIS }, a.actor);
    expect((await ctx.services.invoices.get(doc.id)).buyer).toMatchObject({ address: GENEVA.address, country: 'Switzerland' });
    const exported = await ctx.services.owners.exportData(a.id, admin);
    expect(exported.orders.find((o) => o.reference === orderReference(id))!.buyer).toEqual({ name: PARIS.name, address: PARIS.address, country: 'FR', phone: PARIS.phone });
    clock.advance(MINUTE);
    await orders().transition(id, { to: 'CANCELLED', note: 'Test over.' }, admin);
  });
  describe('its engraving (plan NEXT LOT §3.6.C)', () => {
    const prices = (p: Partial<Record<'EUR' | 'GBP' | 'USD' | 'CHF', number | null>>) => ctx.services.clubProgram.setEngravingPrices({ prices: { EUR: null, GBP: null, USD: null, CHF: null, ...p } }, admin);
    const docsOf = (id: string) => t.db.selectFrom('invoices').select(['kind', 'credit_scope', 'supplements_invoice_id', 'total_minor', 'lines']).where('order_id', '=', id).orderBy('issued_at').orderBy('sequence').execute();
    const mine = async (accountId: string, id: string) => orders().accountOrder(accountId, id);

    it('sets the prices per currency (ADMIN), audited before and after; a currency without a price, a welcome gift or a currency not entered yet offers none', async () => {
      const operator = { type: 'admin' as const, id: (await t.db.insertInto('admin_users').values({ email: 'op-engraving@orbes.test', email_normalized: 'op-engraving@orbes.test', password_hash: 'scrypt$x', role: 'OPERATOR' }).returning('id').executeTakeFirstOrThrow()).id };
      expect(await refusal(ctx.services.clubProgram.setEngravingPrices({ prices: { EUR: 3_000, GBP: null, USD: null, CHF: null } }, { type: 'account', id: operator.id }))).toMatchObject({ code: 'FORBIDDEN', status: 403 });
      expect(await refusal(ctx.services.clubProgram.setEngravingPrices({ prices: { EUR: -1, GBP: null, USD: null, CHF: null } }, admin))).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(await refusal(ctx.services.clubProgram.setEngravingPrices({ prices: { EUR: 1, JPY: 100 } }, admin))).toMatchObject({ code: 'VALIDATION_FAILED' });
      const sheet = await prices({ EUR: 3_000, CHF: 0 });
      expect(sheet).toMatchObject({ prices: { EUR: 3_000, GBP: null, USD: null, CHF: 0 }, updatedAt: clock.now(), updatedBy: { id: admin.id } });
      await prices({ EUR: 3_500 });
      const audit = await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'order.engraving_prices.update').orderBy('id').execute();
      expect(audit.map((x) => x.details).slice(-2)).toEqual([
        { before: {}, after: { EUR: 3_000, CHF: 0 } },
        { before: { EUR: 3_000, CHF: 0 }, after: { EUR: 3_500 } },
      ]);
      const a = await createAccount(t.db);
      // A salon order before its price: no currency, no engraving.
      const request = await t.db.insertInto('shop_requests').values({ account_id: a.id, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
      clock.advance(MINUTE);
      await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, admin);
      const unpriced = (await t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
      expect(await mine(a.id, unpriced)).toMatchObject({ engraving: null, engravingOffer: null, editable: { engraving: false } });
      expect(await refusal(orders().setEngraving(a.id, unpriced, 'J.M.', a.actor))).toEqual({ code: 'ORDER_ENGRAVING_UNAVAILABLE', status: 409, message: 'Engraving is not offered on this order.' });
      // Priced in EUR: offered at € 35; in GBP (no price): none.
      await orders().setTerms(unpriced, { sizeLabel: '58', priceMinor: 420_000, currency: 'EUR' }, admin);
      expect(await mine(a.id, unpriced)).toMatchObject({ engravingOffer: { priceMinor: 3_500, included: false, maxLength: 20 }, editable: { engraving: true } });
      await orders().setTerms(unpriced, { priceMinor: 300_000, currency: 'GBP' }, admin);
      expect((await mine(a.id, unpriced)).engravingOffer).toBeNull();
      // A welcome gift: never.
      const gift = await createModel(t.db, 'GIFT BANGLE');
      await inTransaction(t.db, (tx) => ensureSku(tx, gift, null));
      const program = await ctx.services.clubProgram.read();
      await ctx.services.clubProgram.update({ ...program, giftPlatineModelId: gift }, admin);
      const platine = await createAccount(t.db);
      await holdPieces(t.db, platine.id, 5, f.modelId);
      const parent = await salonOrder(platine.id);
      const giftId = (await t.db.selectFrom('orders').select('id').where('with_order_id', '=', parent).where('channel', '=', 'GIFT').executeTakeFirstOrThrow()).id;
      expect((await mine(platine.id, giftId)).engravingOffer).toBeNull();
      expect(await refusal(orders().setEngraving(platine.id, giftId, 'J.M.', platine.actor))).toMatchObject({ code: 'ORDER_ENGRAVING_UNAVAILABLE' });
      await ctx.services.clubProgram.update({ ...program, giftPlatineModelId: null }, admin);
    });

    it('is added, changed and removed by the collector until packing starts, at the price it took; after PAID a supplementary invoice or a credit note for its line; never its words in the log', async () => {
      await prices({ EUR: 3_000, CHF: 0 });
      const a = await createAccount(t.db);
      const id = await salonOrder(a.id, '62');
      expect(await refusal(orders().setEngraving(a.id, id, 'Twenty-one characters', a.actor))).toEqual({ code: 'VALIDATION_FAILED', status: 400, message: 'Up to 20 characters: letters, figures, spaces and . & ’ -' });
      expect(await refusal(orders().setEngraving(a.id, id, 'J.M.!', a.actor))).toMatchObject({ message: 'Up to 20 characters: letters, figures, spaces and . & ’ -' });
      expect(await refusal(orders().setEngraving(a.id, id, '   ', a.actor))).toMatchObject({ code: 'VALIDATION_FAILED' });
      // Added before PAID, accents and the house's marks allowed: its price, in TOTAL's reckoning.
      const added = await orders().setEngraving(a.id, id, 'Hélène & J.-M. ’26', a.actor);
      expect(added).toMatchObject({ engraving: { text: 'Hélène & J.-M. ’26', priceMinor: 3_000 }, engravingOffer: { priceMinor: 3_000, included: false }, editable: { engraving: true } });
      expect(await row(id)).toMatchObject({ engraving_text: 'Hélène & J.-M. ’26', engraving_minor: 3_000, engraving_by: 'COLLECTOR' });
      // The setting changes: the order keeps its price.
      await prices({ EUR: 4_000, CHF: 0 });
      clock.advance(MINUTE);
      expect((await orders().setEngraving(a.id, id, 'H. & J.-M.', a.actor)).engraving).toEqual({ text: 'H. & J.-M.', priceMinor: 3_000 });
      // Paid: its ENGRAVING line on the invoice; no word on it.
      await pay(id);
      const [invoice] = await docsOf(id);
      expect((invoice!.lines as { kind: string; label: string; amountMinor: number }[]).map((l) => [l.kind, l.label, l.amountMinor])).toEqual([
        ['PIECE', 'MONOLITHE · SIZE 62', 420_000],
        ['ENGRAVING', 'Engraving', 3_000],
      ]);
      // Its words changed after PAID: no document.
      clock.advance(MINUTE);
      await orders().setEngraving(a.id, id, 'H. M.', a.actor);
      expect(await docsOf(id)).toHaveLength(1);
      // Removed after PAID: a credit note for its line; added again: a supplementary invoice at today's price.
      clock.advance(MINUTE);
      expect((await orders().setEngraving(a.id, id, null, a.actor)).engraving).toBeNull();
      expect(await row(id)).toMatchObject({ engraving_text: null, engraving_minor: null, engraving_by: null });
      clock.advance(MINUTE);
      await orders().setEngraving(a.id, id, 'H. M.', a.actor);
      expect((await docsOf(id)).map((d) => [d.kind, d.credit_scope, d.supplements_invoice_id !== null, d.total_minor])).toEqual([
        ['INVOICE', null, false, 423_000],
        ['CREDIT_NOTE', 'LINES', false, 3_000],
        ['INVOICE', null, true, 4_000],
      ]);
      // Removing an engraving already gone changes nothing.
      clock.advance(MINUTE);
      await orders().setEngraving(a.id, id, null, a.actor);
      await orders().setEngraving(a.id, id, null, a.actor);
      expect((await docsOf(id)).map((d) => d.credit_scope)).toEqual([null, 'LINES', null, 'LINES']);
      // Audited by who, its price and whether it was the add-on; never the words, in the log, the events or the journal.
      const audit = await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'order.engraving').where('target_id', '=', id).orderBy('id').execute();
      expect(audit.map((x) => [x.details.by, x.details.priced, x.details.addon, x.details.removed ?? false])).toEqual([
        ['collector', 3_000, false, false],
        ['collector', 3_000, false, false],
        ['collector', 3_000, false, false],
        ['collector', null, false, true],
        ['collector', 4_000, false, false],
        ['collector', null, false, true],
      ]);
      const everything = JSON.stringify([
        await t.db.selectFrom('audit_logs').select('details').execute(),
        await t.db.selectFrom('order_events').select(['note', 'details']).execute(),
        await t.db.selectFrom('event_journal').select('payload').execute(),
        await t.db.selectFrom('invoices').select(['lines', 'buyer']).execute(),
      ]);
      for (const w of ['Hélène', 'H. & J.-M.', 'H. M.']) expect(everything, w).not.toContain(w);
      // A free engraving (CHF 0): no document after PAID.
      const b = await createAccount(t.db);
      const free = await salonOrder(b.id, '64');
      await orders().setTerms(free, { priceMinor: 300_000, currency: 'CHF' }, admin);
      await pay(free);
      expect((await orders().setEngraving(b.id, free, 'B.', b.actor)).engraving).toEqual({ text: 'B.', priceMinor: 0 });
      await orders().setEngraving(b.id, free, null, b.actor);
      expect((await docsOf(free)).map((d) => d.kind)).toEqual(['INVOICE']);
      // Packing started: the words no longer change; a LOCKED account changes nothing.
      await orders().setEngraving(a.id, id, 'H. M.', a.actor);
      await stockPieces(ctx, { skuId: await skuOf('62'), locationId: france, count: 1, material: '925 STERLING SILVER', forOrderIds: [id] }, admin);
      await orders().setAddress(a.id, id, { address: PARIS }, a.actor);
      await ctx.services.logistics.startPacking(id, admin, null);
      expect(await refusal(orders().setEngraving(a.id, id, 'H.', a.actor))).toMatchObject({ code: 'ORDER_PACKING_STARTED', status: 409 });
      expect(await mine(a.id, id)).toMatchObject({ engraving: { text: 'H. M.', priceMinor: 4_000 }, editable: { engraving: false } });
      await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', b.id).execute();
      const locked = await salonOrder(b.id, '64');
      expect(await refusal(orders().setEngraving(b.id, locked, 'B.', b.actor))).toMatchObject({ code: 'ACCOUNT_LOCKED', status: 403 });
      await prices({});
    });

    it('takes the words alone, with no second price, on an order whose release sold the engraving as an add-on; never removed by the collector; an add-on labelled otherwise offers nothing', async () => {
      await prices({ EUR: 3_000 });
      const a = await createAccount(t.db);
      const [order] = await liveSale(a, 1, [{ label: 'ENGRAVING OF YOUR INITIALS AND A DATE', priceMinor: 15_000 }]);
      expect(await mine(a.id, order!)).toMatchObject({ engraving: null, engravingOffer: { priceMinor: null, included: true, maxLength: 20 }, editable: { engraving: true } });
      expect(await orders().setEngraving(a.id, order!, 'A. & L.', a.actor)).toMatchObject({ engraving: { text: 'A. & L.', priceMinor: null } });
      expect(await refusal(orders().setEngraving(a.id, order!, null, a.actor))).toEqual({
        code: 'ORDER_ENGRAVING_INCLUDED',
        status: 409,
        message: 'Your engraving was bought with your order: its words may change until packing begins. ORBES Client Services can assist you.',
      });
      await pay(order!);
      clock.advance(MINUTE);
      await orders().setEngraving(a.id, order!, 'A. L.', a.actor);
      expect(await row(order!)).toMatchObject({ engraving_text: 'A. L.', engraving_minor: null, engraving_by: 'COLLECTOR' });
      // Its invoice: the add-on's line, no ENGRAVING line; no other document.
      const docs = await docsOf(order!);
      expect(docs).toHaveLength(1);
      expect((docs[0]!.lines as { kind: string }[]).map((l) => l.kind)).toEqual(['PIECE', 'ADDON']);
      expect(docs[0]!.total_minor).toBe(495_000);
      const audit = await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'order.engraving').where('target_id', '=', order!).orderBy('id').execute();
      expect(audit.map((x) => [x.details.priced, x.details.addon])).toEqual([[null, true], [null, true]]);
      // An add-on labelled otherwise (GIFT BOX), with no price set: nothing offered.
      await prices({});
      const b = await createAccount(t.db);
      const [boxed] = await liveSale(b, 1, [{ label: 'GIFT BOX', priceMinor: 5_000 }]);
      expect((await mine(b.id, boxed!)).engravingOffer).toBeNull();
    });

    it('prices Client Services\' words as the collector\'s; a currency changed on a RESERVED order reprices a priced engraving, or removes it when that currency has none', async () => {
      await prices({ EUR: 3_000, GBP: 2_500 });
      const a = await createAccount(t.db);
      const id = await salonOrder(a.id, '66');
      await orders().setTerms(id, { engravingText: 'C. S.' }, admin);
      expect(await row(id)).toMatchObject({ engraving_text: 'C. S.', engraving_minor: 3_000, engraving_by: 'STAFF' });
      await orders().setTerms(id, { priceMinor: 350_000, currency: 'GBP' }, admin);
      expect(await row(id)).toMatchObject({ currency: 'GBP', engraving_text: 'C. S.', engraving_minor: 2_500 });
      await orders().setTerms(id, { priceMinor: 400_000, currency: 'USD' }, admin);
      expect(await row(id)).toMatchObject({ currency: 'USD', engraving_text: null, engraving_minor: null, engraving_by: null });
      const events = await t.db.selectFrom('order_events').select('details').where('order_id', '=', id).where('action', '=', 'order.engraving').orderBy('id').execute();
      expect(events.map((e) => e.details)).toEqual([
        { by: 'staff', priced: 2_500, addon: false, currency: true },
        { by: 'staff', priced: null, addon: false, currency: true, removed: true },
      ]);
      await prices({});
    });

    it('removes a priced engraving, with its event, when Client Services clears the price and its currency of a RESERVED order', async () => {
      await prices({ EUR: 3_000 });
      const a = await createAccount(t.db);
      const id = await salonOrder(a.id, '66');
      await orders().setTerms(id, { engravingText: 'C. S.' }, admin);
      expect(await row(id)).toMatchObject({ currency: 'EUR', engraving_text: 'C. S.', engraving_minor: 3_000, engraving_by: 'STAFF' });
      await orders().setTerms(id, { priceMinor: null, currency: null }, admin);
      expect(await row(id)).toMatchObject({ status: 'RESERVED', price_minor: null, currency: null, engraving_text: null, engraving_minor: null, engraving_by: null });
      const events = await t.db.selectFrom('order_events').select('details').where('order_id', '=', id).where('action', '=', 'order.engraving').orderBy('id').execute();
      expect(events.map((e) => e.details)).toEqual([{ by: 'staff', priced: null, addon: false, currency: true, removed: true }]);
      await prices({});
    });
  });
});
