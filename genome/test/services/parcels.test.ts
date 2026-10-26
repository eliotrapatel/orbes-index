/**
 * THE VAULT CARD on the packing checklist (lot Q3, step Q3.8; plan §2.8, N8, N9; vault/SCOPE.md H "SHIPPING CHECKLIST
 * line 'THE VAULT CARD', ticked at packing"), on services/parcels.ts and the services as createContext wires them:
 *
 *  - checklistOf: one line THE VAULT CARD (key `vault-card:<order>`) after the card line of each order that carries it,
 *    "(1 of 2)" as the card lines say which, ticked by hand; none for an order that does not;
 *  - vaultCardOrders: each order whose piece would open a vault at its first registration (N8): LIVE, DRAW, SALON, a
 *    VAULT order bought under a RIGHT TO BUY (price above 0); never a welcome GIFT, a VAULT order at 0 nor an EXCHANGE's
 *    replacement; none while THE VAULT's PIECE source is off; a parcel packed keeps the lines it was packed with;
 *  - a SALON parcel: the line in the parcel's view and its piece's slip flag, Packed refused until it is ticked, stored
 *    with the parcel's checklist; once packed, kept though the PIECE source is switched off; a parcel packed before lot
 *    Q3 (its stored lines without it) and one packed while the source was off show none;
 *  - THE VAULT's own orders: a VAULT order bought under its RIGHT TO BUY carries the line, a VAULT order at 0 (a product
 *    won free) does not.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { inTransaction } from '../../src/server/db/connection.js';
import { jsonText, type OrderChannel } from '../../src/server/db/schema.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { checklistOf, VAULT_CARD_LINE, vaultCardOrders } from '../../src/server/services/parcels.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { VaultService } from '../../src/server/services/vault.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { scanIntoParcel, stockPieces } from '../support/fulfil.js';
import { jpegPhoto } from '../support/images.js';
import { createAccount, liveFixtureOn, sizedModel, type LiveFixture } from '../support/live.js';

const MINUTE = 60_000;

describe('THE VAULT CARD on the packing checklist (step Q3.8)', () => {
  let t: TestDb;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: LiveFixture;
  let staff: Actor & { id: string };
  let france: string;
  let opener: VaultService;

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock('2026-11-02T09:00:00.000Z');
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    f = await liveFixtureOn(ctx, clock);
    staff = f.admin as Actor & { id: string };
    france = (await t.db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
    // Every draw lands on the first row above the floor: each test sets the table it opens.
    opener = new VaultService({ db: t.db, audit: ctx.audit, profiles: ctx.services.profiles, clock: clock.now, random: () => 0, giftKey: new Uint8Array(randomBytes(32)) });
  });
  afterAll(async () => {
    await ctx.close();
    await t.close();
  });

  const lg = () => ctx.services.logistics;
  const vault = () => ctx.services.vault;
  const piece = (enabled: boolean) => vault().setSource('PIECE', { enabled, perOccasion: 1, cap: 1 }, staff);
  const keysOf = (lines: readonly { key: string }[]) => lines.map((l) => l.key);
  const stored = async (key: string) =>
    (await t.db.selectFrom('shipments').select('checklist').where('order_id', '=', key).where('status', '<>', 'CANCELLED').executeTakeFirstOrThrow()).checklist;

  /** A private salon's order closed as ACCEPTED, priced in 58 and paid, its piece in stock at the house's location. */
  async function paidSalonOrder(): Promise<string> {
    const account = await createAccount(t.db);
    const request = await t.db.insertInto('shop_requests').values({ account_id: account.id, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
    clock.advance(MINUTE);
    await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, staff);
    const id = (await t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).where('channel', '=', 'SALON').executeTakeFirstOrThrow()).id;
    await ctx.services.orders.setTerms(id, { sizeLabel: '58', priceMinor: 420_000, currency: 'EUR' }, staff);
    clock.advance(MINUTE);
    await ctx.services.orders.transition(id, { to: 'PAID' }, staff);
    const sku = await inTransaction(t.db, (tx) => ensureSku(tx, f.modelId, '58'));
    await stockPieces(ctx, { skuId: sku, locationId: france, count: 1, material: '925 STERLING SILVER', forOrderIds: [id] }, staff);
    return id;
  }

  /** The parcel scanned and photographed, ready for Packed. */
  async function readyToCheck(id: string): Promise<string> {
    const key = await scanIntoParcel(ctx, id, {}, staff);
    await lg().setPhoto(key, { mime: 'image/jpeg', bytes: jpegPhoto(16, 12) }, staff, null);
    return key;
  }

  it('checklistOf: THE VAULT CARD after the card line of each order that carries it, "(1 of 2)" as the card lines, ticked by hand', () => {
    const a = randomUUID();
    const b = randomUUID();
    const orders = [a, b].map((id) => ({ id, addons: [], engraving_text: null }));
    const lines = checklistOf(orders, new Set([`vault-card:${a}`]), new Set(), { name: 'CUBE 80' }, new Map(), new Set([a]));
    expect(lines.map((l) => [l.key, l.label, l.byScan, l.ticked])).toEqual([
      [`piece:${a}`, 'The right piece: its card scanned (1 of 2)', true, false],
      [`card:${a}`, 'The card, its claim code visible (1 of 2)', false, false],
      [`vault-card:${a}`, 'THE VAULT CARD (1 of 2)', false, true],
      [`piece:${b}`, 'The right piece: its card scanned (2 of 2)', true, false],
      [`card:${b}`, 'The card, its claim code visible (2 of 2)', false, false],
      ['box', 'The box: CUBE 80, and the pouch', false, false],
    ]);
    // One order: the line alone, as the card's; without the set (a parcel of before), no line.
    expect(checklistOf([orders[0]!], new Set(), new Set(), null, new Map(), new Set([a])).find((l) => l.key === `vault-card:${a}`)!.label).toBe(VAULT_CARD_LINE);
    expect(VAULT_CARD_LINE).toBe('THE VAULT CARD');
    expect(keysOf(checklistOf([orders[0]!], new Set(), new Set()))).toEqual([`piece:${a}`, `card:${a}`, 'box']);
  });

  it('vaultCardOrders: LIVE, DRAW, SALON and a VAULT order bought under a RIGHT TO BUY; never a GIFT, a VAULT order at 0 nor an EXCHANGE; none while the PIECE source is off; a parcel packed keeps its stored lines', async () => {
    const row = (channel: OrderChannel, price_minor: number | null) => ({ id: randomUUID(), channel, price_minor });
    const rows = [row('LIVE', 480_000), row('DRAW', 300_000), row('SALON', null), row('VAULT', 120_000), row('GIFT', 0), row('VAULT', 0), row('EXCHANGE', 0)];
    const carried = await vaultCardOrders(t.db, rows);
    expect(rows.map((r) => [r.channel, r.price_minor, carried.has(r.id)])).toEqual([
      ['LIVE', 480_000, true],
      ['DRAW', 300_000, true],
      ['SALON', null, true],
      ['VAULT', 120_000, true],
      ['GIFT', 0, false],
      ['VAULT', 0, false],
      ['EXCHANGE', 0, false],
    ]);
    // THE VAULT's PIECE source off: no vault is added, so no card.
    await piece(false);
    expect([...(await vaultCardOrders(t.db, rows))]).toEqual([]);
    // A parcel packed: exactly its stored lines, whatever the source says now.
    const packed = { packed_at: clock.now(), checklist: [{ key: `vault-card:${rows[1]!.id}`, label: 'THE VAULT CARD (2 of 7)' }, { key: 'box', label: 'The box and the pouch' }] };
    expect([...(await vaultCardOrders(t.db, rows, packed))]).toEqual([rows[1]!.id]);
    await piece(true);
    expect([...(await vaultCardOrders(t.db, rows, { packed_at: clock.now(), checklist: [] }))]).toEqual([]);
    // Still packing (no packed_at): read as now.
    expect((await vaultCardOrders(t.db, rows, { packed_at: null, checklist: [] })).size).toBe(4);
  });

  it('a SALON parcel: the line in its view and its piece flagged for the slip; Packed refused until it is ticked; stored with the parcel and kept once packed though the PIECE source is switched off', async () => {
    const id = await paidSalonOrder();
    const key = await readyToCheck(id);
    const view = await lg().parcel(key, null);
    expect(view.checklist.map((l) => [l.key, l.label, l.byScan])).toEqual([
      [`piece:${id}`, 'The right piece: its card scanned', true],
      [`card:${id}`, 'The card, its claim code visible', false],
      [`vault-card:${id}`, 'THE VAULT CARD', false],
      ['box', 'The box and the pouch', false],
    ]);
    expect(view.orders.map((o) => o.vaultCard)).toEqual([true]);
    // Every line but THE VAULT CARD: refused.
    await expect(lg().checkPacked(key, { ticked: [`card:${id}`, 'box'] }, staff, null)).rejects.toMatchObject({ code: 'PACKING_INCOMPLETE', httpStatus: 422 });
    const packed = await lg().checkPacked(key, { ticked: [`card:${id}`, `vault-card:${id}`, 'box'] }, staff, null);
    expect(packed.step).toBe('PACKED');
    expect(await stored(key)).toEqual([
      { key: `piece:${id}`, label: 'The right piece: its card scanned' },
      { key: `card:${id}`, label: 'The card, its claim code visible' },
      { key: `vault-card:${id}`, label: 'THE VAULT CARD' },
      { key: 'box', label: 'The box and the pouch' },
    ]);
    const audited = await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'order.pack.check').where('target_id', '=', id).executeTakeFirstOrThrow();
    expect(audited.details.keys).toEqual([`piece:${id}`, `card:${id}`, `vault-card:${id}`, 'box']);
    // Packed: what it was packed with, the source switched off since.
    await piece(false);
    const after = await lg().parcel(key, null);
    expect(after.checklist.find((l) => l.key === `vault-card:${id}`)).toEqual({ key: `vault-card:${id}`, label: 'THE VAULT CARD', byScan: false, ticked: true });
    expect(after.orders[0]!.vaultCard).toBe(true);
    await piece(true);
  });

  it('a parcel packed before lot Q3 keeps its stored lines (none); one packed while the PIECE source was off has none, the source switched on since', async () => {
    // Packed before Q3: its stored checklist never had the line.
    const before = await paidSalonOrder();
    const k1 = await readyToCheck(before);
    await lg().checkPacked(k1, { ticked: [`card:${before}`, `vault-card:${before}`, 'box'] }, staff, null);
    await t.db.updateTable('shipments').set({ checklist: jsonText((await stored(k1)).filter((l) => !l.key.startsWith('vault-card:'))) }).where('order_id', '=', k1).execute();
    const read = await lg().parcel(k1, null);
    expect(keysOf(read.checklist)).toEqual([`piece:${before}`, `card:${before}`, 'box']);
    expect(read.orders[0]!.vaultCard).toBe(false);

    // Packed while the source was off: no line to tick, none stored, none shown once it is on again.
    await piece(false);
    const off = await paidSalonOrder();
    const k2 = await readyToCheck(off);
    expect(keysOf((await lg().parcel(k2, null)).checklist)).toEqual([`piece:${off}`, `card:${off}`, 'box']);
    await lg().checkPacked(k2, { ticked: [`card:${off}`, 'box'] }, staff, null);
    await piece(true);
    expect(keysOf(await stored(k2))).toEqual([`piece:${off}`, `card:${off}`, 'box']);
    expect(keysOf((await lg().parcel(k2, null)).checklist)).toEqual([`piece:${off}`, `card:${off}`, 'box']);
  });

  /** The table: `row` alone above the floor (every other row made inactive), drawn by every opening. */
  const only = async (row: Record<string, unknown>) => {
    for (const r of (await vault().settings()).rewards) if (r.kind !== 'I_WAS_THERE' && r.active) await vault().deactivateReward(r.id, staff);
    await vault().createReward({ oddsIn: 2, quantity: 1_000, ...row }, staff);
  };
  const houseVault = async (accountId: string) => (await vault().give({ source: 'HOUSE', accountId, giftId: randomUUID(), givenBy: staff.id })).vaults[0]!;

  it('THE VAULT’s own orders: a VAULT order bought under its RIGHT TO BUY carries the line; a VAULT order at 0 (a product won free) does not', async () => {
    const modelId = await sizedModel(t.db, 'ECLIPSE', ['52']);
    await t.db.updateTable('models').set({ base_price_minor: 120_000, base_currency: 'EUR' }).where('id', '=', modelId).execute();
    const sku = (await t.db.selectFrom('skus').select('id').where('model_id', '=', modelId).where('size_label', '=', '52').executeTakeFirstOrThrow()).id;
    await ctx.services.stock.adjust({ skuId: sku, locationId: france, delta: 2, note: 'Counted.' }, staff);

    // A RIGHT TO BUY: BUY creates a VAULT order at its usual price, whose piece opens a vault: the card goes in.
    await only({ kind: 'PRODUCT', modelId, mode: 'RIGHT_TO_BUY' });
    const buyer = await createAccount(t.db);
    const bought = await houseVault(buyer.id);
    await opener.open(buyer.id, bought.id);
    const { orderId } = await vault().buy(buyer.id, bought.id, { size: '52' });
    expect(await t.db.selectFrom('orders').select(['channel', 'price_minor']).where('id', '=', orderId).executeTakeFirstOrThrow()).toEqual({ channel: 'VAULT', price_minor: 120_000 });
    const rtb = await lg().parcel(orderId, null);
    expect(rtb.checklist.find((l) => l.key === `vault-card:${orderId}`)).toEqual({ key: `vault-card:${orderId}`, label: 'THE VAULT CARD', byScan: false, ticked: false });
    expect(rtb.orders[0]!.vaultCard).toBe(true);

    // Won FREE: a VAULT order at 0, whose piece opens no vault: no card.
    await only({ kind: 'PRODUCT', modelId, mode: 'FREE' });
    const winner = await createAccount(t.db);
    const won = await houseVault(winner.id);
    await opener.open(winner.id, won.id);
    const free = (await t.db.selectFrom('vaults').select('order_id').where('id', '=', won.id).executeTakeFirstOrThrow()).order_id!;
    expect(await t.db.selectFrom('orders').select(['channel', 'price_minor']).where('id', '=', free).executeTakeFirstOrThrow()).toEqual({ channel: 'VAULT', price_minor: 0 });
    const zero = await lg().parcel(free, null);
    expect(keysOf(zero.checklist)).toEqual([`piece:${free}`, `card:${free}`, 'box']);
    expect(zero.orders[0]!.vaultCard).toBe(false);
  });
});
