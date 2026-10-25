/**
 * THE VAULT's rewards delivered at the opening (lot Q3, step Q3.4; plan §2.4, §2.7; vault/SCOPE.md E7 "house credit (30
 * days) … a free add-on … a guaranteed piece at the next LIVE release … a credit to give (a friend's first piece). No
 * access, status or service rewards.", E9 "credits in YOUR ACCOUNT, products in YOUR ORDERS, plus a FROM ORBES
 * message", E10 "rewards expire; no cash value; not transferable", OP-22, round 3 "Not chosen: every access, status and
 * service reward"):
 *
 *  - CREDIT: a VAULT credit of the row's amount for 30 days, in creditBalances whatever the tier, IN USE's vaultCredit,
 *    taken off an order by Apply credit right after the birthday credit, CREDIT · VAULT on the invoice, in the export;
 *  - ADDON: the vault's offer for 30 days, one unit at 0 (source VAULT) on the account's next order at its creation (a
 *    salon's here), never on a welcome gift, a size exchange, a VAULT order nor an order travelling with another; none
 *    left at the order's location: nothing attached, the offer waits; used once; past its 30 days, nothing; a SERVICE
 *    add-on refused as a vault's reward (VAULT_REWARD_SERVICE, worded), as an ADDON and as a PRODUCT;
 *  - GUARANTEED: a house guarantee of scope LIVE (1 piece, the settings' default days, shown, its vault named), set aside
 *    for the next published LIVE release that is not an after-room (at once, or at the next one published), never a
 *    draw; the collector reads it as a guaranteed place at a coming release;
 *  - CREDIT TO GIVE: a one-time code (30 days) shown to its owner while it can be accepted, its link read without the
 *    giver, accepted by a friend holding no piece (a VAULT credit usable while they hold none, 30 days), never by the
 *    giver nor an account holding a piece, once; accepting it sets no `invited_by`; past its 30 days, ended;
 *  - I WAS THERE: nothing but its card; and every opening's FROM ORBES receipt, once;
 *  - (step Q3.7; plan §2.4 PRODUCT, VAULT_EDITION, THE_PIECE, §2.5, §4.5; E8 "A product won free: default address (YOUR
 *    ORDERS asks if none), shipped free, claimed within 30 days or back to stock"; round 2 "Right to buy: 24 HOURS, at
 *    its usual price"; E7 VAULT EDITION "never sold") a product won FREE: a VAULT order at 0 holding the unit reserved at
 *    the opening (the size from YOUR SIZES, else the most stock; none: the card); a size sold out elsewhere after the
 *    win still claimed; the size changed at the claim only to one with stock (VAULT_SIZE_NONE_LEFT); the address asked;
 *    unclaimed at its claim_by, cancelled by the housekeeping job `vaults` with its unit back to stock; a model's right to
 *    buy within / after 24 hours; an add-on's right to buy as ADD on an order; THE PIECE in the entry's size, never
 *    changed; a VAULT EDITION; a vault-only model refused by every sales path and still in the lookbook.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, startHousekeeping, type AppContext } from '../../src/server/context.js';
import { inTransaction } from '../../src/server/db/connection.js';
import type { OrderRow } from '../../src/server/db/schema.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { birthdayExpiry } from '../../src/server/services/birthday-credits.js';
import { accountGuarantees, coverOnPublish, endOfParisDay, exportedGuarantees, parisDayPlus } from '../../src/server/services/guarantees.js';
import { linesOf } from '../../src/server/services/invoices.js';
import { attachVaultAddons } from '../../src/server/services/order-addons.js';
import { parisDay } from '../../src/server/services/schedule.js';
import { stockLevel } from '../../src/server/services/stock.js';
import { accountTierGrants, creditBalances, usableAt } from '../../src/server/services/tier-grants.js';
import { hashVaultGiftCode, vaultRewardUntil, VaultService, VAULT_DRAW_PARTS } from '../../src/server/services/vault.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { poolDraw } from '../support/draws.js';
import { createAccount, createLiveRelease, holdPieces, liveFixtureOn, sizedModel, type LiveFixture } from '../support/live.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('THE VAULT’s rewards delivered (step Q3.4)', () => {
  let t: TestDb;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: LiveFixture;
  let staff: Actor & { id: string };
  let france: string;
  let opener: VaultService;
  const giftKey = new Uint8Array(randomBytes(32));
  /** Every draw lands on the first row above the floor: each test sets the table it opens. */
  const next = 0;
  /** POLISHING CLOTH (a PRODUCT add-on, EUR 15) and GIFT WRAPPING (a SERVICE). */
  let cloth: { id: string; skuId: string };
  let wrap: { id: string };

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock('2026-11-02T09:00:00.000Z');
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    f = await liveFixtureOn(ctx, clock);
    staff = f.admin as Actor & { id: string };
    france = (await t.db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
    opener = new VaultService({ db: t.db, audit: ctx.audit, profiles: ctx.services.profiles, clock: clock.now, random: () => next, giftKey });
    const a = await ctx.services.addons.create({ name: 'POLISHING CLOTH', skuCode: 'ADD-CLOTH', prices: { EUR: 1_500 }, weightG: 20 }, staff);
    cloth = { id: a.id, skuId: a.sku.id };
    wrap = await ctx.services.addons.create({ kind: 'SERVICE', name: 'GIFT WRAPPING', skuCode: 'ADD-WRAP', prices: { EUR: 500 }, offeredAt: { live: true, draw: true, salon: true, orders: true } }, staff);
  });
  afterAll(async () => {
    await ctx.close();
    await t.close();
  });

  const vault = () => ctx.services.vault;
  const orders = () => ctx.services.orders;
  /** The table: `row` alone above the floor (every other row made inactive), drawn by every opening (1 IN 2). */
  const only = async (row: Record<string, unknown>) => {
    for (const r of (await vault().settings()).rewards) if (r.kind !== 'I_WAS_THERE' && r.active) await vault().deactivateReward(r.id, staff);
    if (Object.keys(row).length === 0) return null;
    const s = await vault().createReward({ oddsIn: 2, quantity: 1_000, ...row }, staff);
    return s.rewards.find((r) => r.active && r.kind === row.kind)!.id;
  };
  const houseVault = async (accountId: string) => (await vault().give({ source: 'HOUSE', accountId, giftId: randomUUID(), givenBy: staff.id })).vaults[0]!;
  const vaultRow = (id: string) => t.db.selectFrom('vaults').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const receipt = (vaultId: string) => t.db.selectFrom('house_deliveries').select(['title', 'body']).where('dedupe_key', '=', `VAULT_OPENED:${vaultId}`).execute();
  const unitsOf = (orderId: string) => t.db.selectFrom('order_addon_items').selectAll().where('order_id', '=', orderId).orderBy('added_at').execute();
  /** A private salon's order closed as ACCEPTED (its add-ons and a vault's free one attached at its creation), priced when asked. */
  async function salonOrder(accountId: string, priceMinor?: number): Promise<string> {
    const request = await t.db.insertInto('shop_requests').values({ account_id: accountId, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
    clock.advance(MINUTE);
    await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, staff);
    const id = (await t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).where('channel', '=', 'SALON').executeTakeFirstOrThrow()).id;
    if (priceMinor !== undefined) await orders().setTerms(id, { sizeLabel: '58', priceMinor, currency: 'EUR' }, staff);
    return id;
  }

  it('CREDIT: a VAULT credit of its amount for 30 days, usable whatever the tier, IN USE, taken right after the birthday credit, CREDIT · VAULT on the invoice, exported', async () => {
    await only({ kind: 'CREDIT', amountMinor: 2_500, currency: 'EUR' });
    const a = await createAccount(t.db);
    const v = await houseVault(a.id);
    const now = clock.now();
    expect(await opener.open(a.id, v.id)).toMatchObject({ kind: 'CREDIT', prize: '€25', line: 'House credit, valid 30 days.', where: 'ACCOUNT', giftCode: null });
    const row = await vaultRow(v.id);
    const grant = await t.db.selectFrom('tier_grants').selectAll().where('id', '=', row.grant_id!).executeTakeFirstOrThrow();
    expect(grant).toMatchObject({ account_id: a.id, kind: 'VAULT', tier: null, vault_id: v.id, amount_minor: 2_500, currency: 'EUR', usable_while_no_piece: false, birthday_on: null });
    // 30 days, the opening's Paris day the first (as the birthday credit's).
    expect(grant.expires_at).toEqual(birthdayExpiry(parisDay(now), 30));
    expect(grant.expires_at).toEqual(vaultRewardUntil(now));
    expect(row).toMatchObject({ value_minor: 2_500, currency: 'EUR', cost_minor: 2_500 });
    // In YOUR ACCOUNT: a credit like the others, for an account without a piece too.
    const [balance] = await creditBalances(t.db, a.id);
    expect(balance).toEqual({ grantId: grant.id, kind: 'VAULT', tier: null, birthdayOn: null, usableWhileNoPiece: false, amountMinor: 2_500, balanceMinor: 2_500, currency: 'EUR', expiresAt: grant.expires_at });
    expect([0, 1, 2, 3].map((tier) => usableAt(balance!, tier))).toEqual([true, true, true, true]);
    expect((await ctx.services.club.inUse(a.id, 0)).vaultCredit).toEqual({ balanceMinor: 2_500, currency: 'EUR', expiresAt: grant.expires_at });
    expect(await receipt(v.id)).toEqual([{ title: 'FROM THE VAULT', body: 'Your vault held €25 · House credit, valid 30 days. It is in YOUR ACCOUNT.' }]);

    // Apply credit: the birthday credit first, then the vault's; CREDIT · VAULT on the invoice after CREDIT · BIRTHDAY.
    await t.db
      .insertInto('tier_grants')
      .values({ account_id: a.id, tier: null, kind: 'BIRTHDAY', granted_at: now, amount_minor: 2_000, currency: 'EUR', expires_at: birthdayExpiry(parisDay(now), 30), birthday_on: parisDay(now) })
      .execute();
    const id = await salonOrder(a.id, 300_000);
    expect((await orders().get(id)).credit.available.map((c) => [c.kind, c.tier, c.balanceMinor])).toEqual([
      ['BIRTHDAY', null, 2_000],
      ['VAULT', null, 2_500],
    ]);
    // Taken at one instant, the uses' order says nothing: the birthday credit whole, then € 10 of the vault's.
    const applied = await orders().applyCredit(id, 3_000, staff);
    expect(applied.credit.applied.map((u) => [u.kind, u.tier, u.amountMinor]).sort()).toEqual([
      ['BIRTHDAY', null, 2_000],
      ['VAULT', null, 1_000],
    ]);
    clock.advance(MINUTE);
    await orders().transition(id, { to: 'PAID' }, staff);
    const invoice = await t.db.selectFrom('invoices').selectAll().where('order_id', '=', id).where('kind', '=', 'INVOICE').executeTakeFirstOrThrow();
    expect(linesOf(invoice.lines).filter((l) => l.kind === 'CREDIT').map((l) => [l.label, l.amountMinor])).toEqual([
      ['CREDIT · BIRTHDAY', -2_000],
      ['CREDIT · VAULT', -1_000],
    ]);
    // The account's copy of its data: the vault's credit, its balance and its use.
    const exported = (await accountTierGrants(t.db, a.id)).find((g) => g.kind === 'VAULT')!;
    expect(exported).toMatchObject({ tier: null, kind: 'VAULT', amountMinor: 2_500, currency: 'EUR', balanceMinor: 1_500, uses: [{ amountMinor: 1_000, releasedAt: null }] });
  });

  it('ADDON: one unit at 0 (source VAULT) on the next order at its creation, within 30 days, once; none left: the offer waits; never a gift, an exchange, a VAULT order or an order travelling with another', async () => {
    await only({ kind: 'ADDON', addonId: cloth.id });
    const a = await createAccount(t.db);
    const v = await houseVault(a.id);
    const now = clock.now();
    expect(await opener.open(a.id, v.id)).toMatchObject({ kind: 'ADDON', prize: 'POLISHING CLOTH', line: 'Free on your next order.', where: 'ORDERS', rare: false });
    expect(await vaultRow(v.id)).toMatchObject({ offer_until: vaultRewardUntil(now), offer_used_at: null, grant_id: null, value_minor: null });
    expect(await receipt(v.id)).toEqual([{ title: 'FROM THE VAULT', body: 'Your vault held POLISHING CLOTH · Free on your next order. It is in YOUR ORDERS.' }]);

    // None left at the order's location: nothing attached, the offer waits.
    const left = (await stockLevel(t.db, cloth.skuId, france)).available;
    if (left > 0) await ctx.services.stock.adjust({ skuId: cloth.skuId, locationId: france, delta: -left, note: 'Damaged.' }, staff);
    const without = await salonOrder(a.id);
    expect(await unitsOf(without)).toEqual([]);
    expect((await vaultRow(v.id)).offer_used_at).toBeNull();

    // Never on a welcome gift, a size exchange, a VAULT order or an order travelling with another.
    await ctx.services.stock.adjust({ skuId: cloth.skuId, locationId: france, delta: 2, note: 'Counted.' }, staff);
    const row = (await t.db.selectFrom('orders').selectAll().where('id', '=', without).executeTakeFirstOrThrow()) as OrderRow;
    for (const parent of [{ ...row, channel: 'GIFT' as const }, { ...row, channel: 'EXCHANGE' as const }, { ...row, channel: 'VAULT' as const }, { ...row, with_order_id: randomUUID() }]) {
      expect(await inTransaction(t.db, (tx) => attachVaultAddons(tx, parent, staff, clock.now()))).toEqual({ unitIds: [], notes: [] });
    }
    expect((await vaultRow(v.id)).offer_used_at).toBeNull();

    // The next order: one unit at 0, its source the vault, held at the order's location; the offer used.
    const id = await salonOrder(a.id);
    const [unit, ...more] = await unitsOf(id);
    expect(more).toEqual([]);
    expect(unit).toMatchObject({ addon_id: cloth.id, sku_id: cloth.skuId, price_minor: 0, currency: 'EUR', added_by_type: 'VAULT', added_by: null, vault_id: v.id, status: 'HELD', location_id: france });
    expect((await vaultRow(v.id)).offer_used_at).toEqual(clock.now());
    const event = await t.db.selectFrom('order_events').select('details').where('order_id', '=', id).where('action', '=', 'order.addon.add').executeTakeFirstOrThrow();
    expect(event.details).toMatchObject({ addonId: cloth.id, units: 1, priceMinor: 0, vaultId: v.id, by: 'vault' });
    // Used once: the order after takes none.
    expect(await unitsOf(await salonOrder(a.id))).toEqual([]);

    // Past its 30 days, nothing.
    const b = await createAccount(t.db);
    const w = await houseVault(b.id);
    await opener.open(b.id, w.id);
    clock.set(new Date((await vaultRow(w.id)).offer_until!.getTime() + MINUTE));
    expect(await unitsOf(await salonOrder(b.id))).toEqual([]);
    expect((await vaultRow(w.id)).offer_used_at).toBeNull();
  });

  it('a SERVICE add-on is never a vault’s reward (E7, round 3): refused as an ADDON and as a PRODUCT, worded; an add-on set aside since gives the card', async () => {
    for (const input of [
      { kind: 'ADDON', oddsIn: 100, quantity: 10, addonId: wrap.id },
      { kind: 'PRODUCT', oddsIn: 100, quantity: 10, addonId: wrap.id, mode: 'FREE' },
      { kind: 'PRODUCT', oddsIn: 100, quantity: 10, addonId: wrap.id, mode: 'RIGHT_TO_BUY' },
    ]) {
      await expect(vault().createReward(input, staff)).rejects.toMatchObject({ code: 'VAULT_REWARD_SERVICE', httpStatus: 409, message: 'A service cannot be a vault’s reward.' });
    }
    const id = (await only({ kind: 'ADDON', addonId: cloth.id }))!;
    await expect(vault().updateReward(id, { oddsIn: 2, quantity: 1_000, addonId: wrap.id }, staff)).rejects.toMatchObject({ code: 'VAULT_REWARD_SERVICE' });
    await t.db.updateTable('addon_items').set({ active: false }).where('id', '=', cloth.id).execute();
    const a = await createAccount(t.db);
    const v = await houseVault(a.id);
    expect(await opener.open(a.id, v.id)).toMatchObject({ kind: 'I_WAS_THERE', odds: '1 IN 2' });
    expect((await vaultRow(v.id)).offer_until).toBeNull();
    await t.db.updateTable('addon_items').set({ active: true }).where('id', '=', cloth.id).execute();
  });

  it('a PRODUCT add-on: won FREE, as a free add-on; under its RIGHT TO BUY, its offer for 24 hours (round 2)', async () => {
    await only({ kind: 'PRODUCT', addonId: cloth.id, mode: 'RIGHT_TO_BUY' });
    const a = await createAccount(t.db);
    const v = await houseVault(a.id);
    const now = clock.now();
    expect(await opener.open(a.id, v.id)).toMatchObject({ kind: 'PRODUCT', prize: 'POLISHING CLOTH', line: 'Yours to buy at its price, for 24 hours.', where: 'ORDERS' });
    expect((await vaultRow(v.id)).offer_until).toEqual(new Date(now.getTime() + 24 * HOUR));
    // A right to buy is bought (step Q3.7), never attached free.
    expect(await unitsOf(await salonOrder(a.id))).toEqual([]);
    await only({ kind: 'PRODUCT', addonId: cloth.id, mode: 'FREE' });
    const w = await houseVault(a.id);
    expect(await opener.open(a.id, w.id)).toMatchObject({ kind: 'PRODUCT', line: 'Free on your next order.' });
    expect((await vaultRow(w.id)).offer_until).toEqual(vaultRewardUntil(clock.now()));
    expect((await unitsOf(await salonOrder(a.id))).map((u) => [u.added_by_type, u.price_minor, u.vault_id])).toEqual([['VAULT', 0, w.id]]);
  });

  it('GUARANTEED: a house guarantee of scope LIVE, set aside for the next LIVE release that is not an after-room, never a draw; read as a place at a coming release', async () => {
    await only({ kind: 'GUARANTEED' });
    const a = await createAccount(t.db);
    const v = await houseVault(a.id);
    const now = clock.now();
    expect(await opener.open(a.id, v.id)).toMatchObject({ kind: 'GUARANTEED', prize: 'GUARANTEED', line: 'A piece at the next LIVE release.', rare: true, where: 'ACCOUNT' });
    const row = await vaultRow(v.id);
    const g = await t.db.selectFrom('house_guarantees').selectAll().where('id', '=', row.guarantee_id!).executeTakeFirstOrThrow();
    // 1 piece, the settings' default days (90) to the end of that Paris day, shown, granted by no one: its vault named.
    expect(g).toMatchObject({ account_id: a.id, scope: 'LIVE', vault_id: v.id, drop_id: null, model_id: null, collection_id: null, pieces: 1, visible: true, note: null, granted_by: null, status: 'ACTIVE', covered_drop_id: null });
    expect(g.valid_until).toEqual(endOfParisDay(parisDayPlus(now, 90)));
    const grantAudit = await t.db.selectFrom('audit_logs').select(['actor_type', 'details']).where('action', '=', 'guarantee.grant').where('target_id', '=', g.id).executeTakeFirstOrThrow();
    expect(grantAudit).toMatchObject({ actor_type: 'system', details: { scope: 'LIVE', vaultId: v.id, pieces: 1, coveredDropId: null } });
    expect(await accountGuarantees(t.db, a.id, now)).toEqual([{ id: g.id, scope: 'LIVE', target: null, pieces: 1, validUntil: g.valid_until, release: null }]);
    expect((await exportedGuarantees(t.db, a.id))[0]).toMatchObject({ scope: 'LIVE', target: 'Next LIVE release' });

    // A draw published: never covered. An after-room: never. The next LIVE release published: set aside for it.
    const opensAt = new Date(now.getTime() + 2 * DAY);
    const read = (id: string) => t.db.selectFrom('drops').select(['id', 'mode', 'title', 'model_id', 'set_id', 'quantity', 'opens_at', 'closes_at', 'published_at', 'cancelled_at', 'drawn_at', 'ended_at', 'parent_drop_id', 'name_at', 'announce_at']).where('id', '=', id).executeTakeFirstOrThrow();
    const cover = async (id: string) => {
      const d = await read(id);
      return inTransaction(t.db, (tx) => coverOnPublish(tx, d, clock.now(), staff, []));
    };
    const draw = await poolDraw(ctx.services.drops, t.db, { modelId: f.modelId, title: 'A DRAW', quantity: 5, opensAt, closesAt: new Date(opensAt.getTime() + HOUR), earlyAccessHours: 0 }, staff, { publish: false });
    expect(await cover(draw.id)).toBe(0);
    const release = await createLiveRelease(f, { opensAt, published: false, afterRoom: { modelId: f.modelId, priceMinor: 100_000, sizes: [{ label: '52', stock: 1 }] } });
    expect(await cover(release.afterRoom!.id)).toBe(0);
    expect((await t.db.selectFrom('house_guarantees').select('covered_drop_id').where('id', '=', g.id).executeTakeFirstOrThrow()).covered_drop_id).toBeNull();
    expect(await cover(release.id)).toBe(1);
    expect((await t.db.selectFrom('house_guarantees').select('covered_drop_id').where('id', '=', g.id).executeTakeFirstOrThrow()).covered_drop_id).toBe(release.id);

    // Opened while a LIVE release is published: set aside for it at once.
    await t.db.updateTable('drops').set({ published_at: clock.now() }).where('id', '=', release.id).execute();
    const b = await createAccount(t.db);
    const w = await houseVault(b.id);
    await opener.open(b.id, w.id);
    const gb = await t.db.selectFrom('house_guarantees').selectAll().where('vault_id', '=', w.id).executeTakeFirstOrThrow();
    expect(gb).toMatchObject({ scope: 'LIVE', covered_drop_id: release.id });
    expect((await accountGuarantees(t.db, b.id, clock.now()))[0]).toMatchObject({ scope: 'LIVE', target: null, release: { id: release.id, mode: 'LIVE' } });
  });

  it('CREDIT TO GIVE: a one-time code for 30 days, accepted once by a friend holding no piece (a credit for a first piece), never by its giver or a holder; no invited_by', async () => {
    await only({ kind: 'CREDIT_TO_GIVE', amountMinor: 3_000, currency: 'EUR' });
    const giver = await createAccount(t.db);
    await holdPieces(t.db, giver.id, 1, f.modelId);
    const v = await houseVault(giver.id);
    const now = clock.now();
    const reveal = await opener.open(giver.id, v.id);
    expect(reveal).toMatchObject({ kind: 'CREDIT_TO_GIVE', prize: '€30 TO GIVE', line: 'For a friend’s first piece.', where: 'ACCOUNT' });
    const code = reveal.giftCode!;
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    const row = await vaultRow(v.id);
    const gift = await t.db.selectFrom('vault_gifts').selectAll().where('id', '=', row.gift_id!).executeTakeFirstOrThrow();
    expect(gift).toMatchObject({ vault_id: v.id, amount_minor: 3_000, currency: 'EUR', accepted_by: null, grant_id: null });
    expect(Buffer.from(gift.code_hash)).toEqual(Buffer.from(hashVaultGiftCode(code, giftKey)!));
    expect(gift.expires_at.getTime() - gift.created_at.getTime()).toBe(30 * DAY);
    expect(row).toMatchObject({ value_minor: 3_000, currency: 'EUR', grant_id: null });
    // Its code again, to its owner only (the reveal read again, OPENED's GIVE IT).
    expect((await opener.open(giver.id, v.id)).giftCode).toBe(code);
    expect((await opener.forAccount(giver.id)).opened.find((o) => o.id === v.id)!.gift).toEqual({ code, given: false });

    // Its link: the amount and until when, nothing of the giver; who may accept it.
    const friend = await createAccount(t.db);
    const holder = await createAccount(t.db);
    await holdPieces(t.db, holder.id, 1, f.modelId);
    expect(await opener.gift(code, null)).toEqual({ amount: '€30', amountMinor: 3_000, currency: 'EUR', expiresAt: gift.expires_at, expiresDay: parisDay(gift.expires_at), state: 'OPEN', canAccept: null, refusal: null });
    expect(await opener.gift(code.toLowerCase().replace(/-/g, ' '), friend.id)).toMatchObject({ state: 'OPEN', canAccept: true, refusal: null });
    expect(await opener.gift(code, giver.id)).toMatchObject({ canAccept: false, refusal: 'This credit is yours to give to a friend.' });
    expect(await opener.gift(code, holder.id)).toMatchObject({ canAccept: false, refusal: 'This credit is for a friend’s first piece: an account that holds a piece cannot accept it.' });
    await expect(opener.gift('ZZZZ-ZZZZ-ZZZZ', friend.id)).rejects.toMatchObject({ code: 'VAULT_GIFT_NOT_FOUND', httpStatus: 404 });
    await expect(opener.gift('nope', friend.id)).rejects.toMatchObject({ code: 'VAULT_GIFT_NOT_FOUND' });
    await expect(opener.acceptGift(giver.id, code)).rejects.toMatchObject({ code: 'VAULT_GIFT_NOT_FOR_YOU', httpStatus: 409 });
    await expect(opener.acceptGift(holder.id, code)).rejects.toMatchObject({ code: 'VAULT_GIFT_NOT_FOR_YOU', message: 'This credit is for a friend’s first piece: an account that holds a piece cannot accept it.' });
    // The code of another key (another server) is not known.
    const elsewhere = new VaultService({ db: t.db, audit: ctx.audit, profiles: ctx.services.profiles, clock: clock.now, giftKey: new Uint8Array(randomBytes(32)) });
    await expect(elsewhere.acceptGift(friend.id, code)).rejects.toMatchObject({ code: 'VAULT_GIFT_NOT_FOUND' });

    // Accepted by the friend: a VAULT credit for a first piece, 30 days from now; nothing else written.
    clock.advance(DAY);
    const accepted = await opener.acceptGift(friend.id, code);
    expect(accepted).toEqual({ grantId: expect.any(String), amountMinor: 3_000, currency: 'EUR', expiresAt: vaultRewardUntil(clock.now()) });
    const credit = await t.db.selectFrom('tier_grants').selectAll().where('id', '=', accepted.grantId).executeTakeFirstOrThrow();
    expect(credit).toMatchObject({ account_id: friend.id, kind: 'VAULT', tier: null, vault_id: v.id, usable_while_no_piece: true, amount_minor: 3_000, currency: 'EUR' });
    expect(await t.db.selectFrom('vault_gifts').select(['accepted_by', 'accepted_at', 'grant_id']).where('id', '=', gift.id).executeTakeFirstOrThrow()).toEqual({ accepted_by: friend.id, accepted_at: clock.now(), grant_id: credit.id });
    expect((await t.db.selectFrom('accounts').select(['invited_by', 'invited_at']).where('id', '=', friend.id).executeTakeFirstOrThrow())).toEqual({ invited_by: null, invited_at: null });
    expect(await t.db.selectFrom('audit_logs').select(['actor_type', 'actor_id', 'details']).where('action', '=', 'vault.gift.accept').where('target_id', '=', gift.id).execute()).toEqual([
      { actor_type: 'account', actor_id: friend.id, details: { vaultId: v.id, grantId: credit.id } },
    ]);
    // Once: the friend again reads its credit; another account, the giver's OPENED row: GIVEN.
    expect(await opener.acceptGift(friend.id, code)).toEqual(accepted);
    await expect(opener.acceptGift((await createAccount(t.db)).id, code)).rejects.toMatchObject({ code: 'VAULT_GIFT_ENDED', httpStatus: 409 });
    expect(await opener.gift(code, friend.id)).toMatchObject({ state: 'ACCEPTED', canAccept: false });
    expect(await opener.gift(code, null)).toMatchObject({ state: 'ENDED', canAccept: null });
    expect((await opener.forAccount(giver.id)).opened.find((o) => o.id === v.id)!.gift).toEqual({ code: null, given: true });
    expect((await opener.open(giver.id, v.id)).giftCode).toBeNull();

    // The friend's credit: usable while they hold no piece, IN USE; with a piece, no longer.
    const [balance] = await creditBalances(t.db, friend.id);
    expect(balance).toMatchObject({ kind: 'VAULT', usableWhileNoPiece: true, balanceMinor: 3_000 });
    expect([0, 1, 2, 3].map((tier) => usableAt(balance!, tier))).toEqual([true, false, false, false]);
    expect((await ctx.services.club.inUse(friend.id, 0)).vaultCredit).toMatchObject({ balanceMinor: 3_000, currency: 'EUR' });
    await holdPieces(t.db, friend.id, 1, f.modelId);
    expect((await ctx.services.club.inUse(friend.id, 1)).vaultCredit).toBeNull();

    // Past its 30 days, a credit to give can no longer be accepted.
    const late = await houseVault(giver.id);
    const lateCode = (await opener.open(giver.id, late.id)).giftCode!;
    clock.advance(30 * DAY);
    await expect(opener.acceptGift((await createAccount(t.db)).id, lateCode)).rejects.toMatchObject({ code: 'VAULT_GIFT_ENDED' });
    expect(await opener.gift(lateCode, null)).toMatchObject({ state: 'ENDED' });
    expect((await opener.open(giver.id, late.id)).giftCode).toBeNull();
  });

  it('I WAS THERE: nothing but its card; the receipt says where it is', async () => {
    await only({});
    const a = await createAccount(t.db);
    const v = await houseVault(a.id);
    expect(await opener.open(a.id, v.id)).toMatchObject({ kind: 'I_WAS_THERE', prize: 'I WAS THERE', line: 'Your card. Save it.', odds: '1 IN 1', rare: false, where: 'NONE', giftCode: null });
    expect(await vaultRow(v.id)).toMatchObject({ grant_id: null, order_id: null, guarantee_id: null, gift_id: null, offer_until: null, value_minor: null, currency: null, cost_minor: 0 });
    expect(await receipt(v.id)).toEqual([{ title: 'FROM THE VAULT', body: 'Your vault held I WAS THERE · Your card. Save it. It is under THE VAULT.' }]);
    expect(VAULT_DRAW_PARTS).toBe(1_000_000);
  });

  it('GUARANTEED in a LIVE vault opened on SOLD OUT while its release still sells: never covers that release, the next LIVE one instead (OP-22, D4, D17)', async () => {
    await only({ kind: 'GUARANTEED' });
    const a = await createAccount(t.db);
    const start = clock.now();
    // Its release: two sizes, the other still selling; the next LIVE release, published, opening a day later.
    const r = await createLiveRelease(f, { opensAt: new Date(start.getTime() + HOUR), closesAt: new Date(start.getTime() + 3 * HOUR), sizes: [{ label: '52', stock: 1 }, { label: '54', stock: 1 }] });
    await t.db.updateTable('drops').set({ vault_on: true }).where('id', '=', r.id).execute();
    const later = await createLiveRelease(f, { opensAt: new Date(start.getTime() + DAY), sizes: [{ label: '52', stock: 1 }] });
    clock.set(new Date(start.getTime() + HOUR - MINUTE));
    await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
    const entry = await t.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', a.id).executeTakeFirstOrThrow();
    const v = (await vault().give({ source: 'LIVE', accountId: a.id, dropId: r.id, entryId: entry.id })).vaults[0]!;
    // Opened while the release runs (its size sold out, the other still on sale).
    clock.set(new Date(start.getTime() + 2 * HOUR));
    expect(await opener.open(a.id, v.id)).toMatchObject({ kind: 'GUARANTEED', where: 'ACCOUNT' });
    const g = await t.db.selectFrom('house_guarantees').selectAll().where('vault_id', '=', v.id).executeTakeFirstOrThrow();
    expect(g).toMatchObject({ scope: 'LIVE', covered_drop_id: later.id });
    expect(await ctx.services.liveRoom.guaranteeShown(a.id, r.id)).toBeNull();
    expect(await ctx.services.liveRoom.guaranteeShown(a.id, later.id)).toEqual({ pieces: 1 });
    expect((await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'guarantee.grant').where('target_id', '=', g.id).executeTakeFirstOrThrow()).details).toMatchObject({ coveredDropId: later.id });
  });
  // ── Products from the vault (step Q3.7; plan §2.4 PRODUCT, VAULT_EDITION, THE_PIECE, §2.5, §4.5) ──────────────

  /** A model of `labels`, priced (its usual price), with `stock` units of each size at the house's location. */
  async function stockedModel(name: string, stock: Record<string, number>, priceMinor = 90_000): Promise<{ id: string; name: string; sku: Record<string, string> }> {
    const labels = Object.keys(stock);
    const id = await sizedModel(t.db, name, labels);
    await t.db.updateTable('models').set({ base_price_minor: priceMinor, base_currency: 'EUR' }).where('id', '=', id).execute();
    const sku: Record<string, string> = {};
    for (const k of await t.db.selectFrom('skus').select(['id', 'size_label']).where('model_id', '=', id).execute()) sku[k.size_label!] = k.id;
    for (const l of labels) if (stock[l]! > 0) await ctx.services.stock.adjust({ skuId: sku[l]!, locationId: france, delta: stock[l]!, note: 'Counted.' }, staff);
    const m = await t.db.selectFrom('models').select('name').where('id', '=', id).executeTakeFirstOrThrow();
    return { id, name: m.name, sku };
  }
  const level = async (skuId: string) => (await stockLevel(t.db, skuId, france)).available;
  const orderOf = (id: string) => t.db.selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const PARIS = { name: 'Camille Martin', address: '12 rue de Rivoli\n75004 Paris', country: 'FR', phone: '+33 6 12 34 56 78' };
  /** A piece won free: the table's one row a FREE product of `model`, a new account's house vault opened. */
  async function winFree(modelId: string, sizeMm?: number) {
    const a = await createAccount(t.db);
    if (sizeMm !== undefined) await t.db.insertInto('account_sizes').values({ account_id: a.id, kind: 'RING', value_mm: sizeMm }).execute();
    const v = await houseVault(a.id);
    const now = clock.now();
    const reveal = await opener.open(a.id, v.id);
    const row = await vaultRow(v.id);
    return { a, v, now, reveal, row, order: row.order_id ? await orderOf(row.order_id) : null };
  }

  it('PRODUCT won FREE: a VAULT order at 0 holding the unit reserved at the opening, the size from YOUR SIZES, else the size with the most stock; none in any size: the card', async () => {
    const m = await stockedModel('ECLIPSE', { '50': 0, '52': 0, '54': 0 });
    await only({ kind: 'PRODUCT', modelId: m.id, mode: 'FREE' });
    // No unit in any size: the row cannot give, the card at its odds.
    const none = await winFree(m.id);
    expect(none.reveal).toMatchObject({ kind: 'I_WAS_THERE', odds: '1 IN 2' });
    expect(none.order).toBeNull();
    for (const [l, n] of [['50', 1], ['52', 3], ['54', 2]] as const) await ctx.services.stock.adjust({ skuId: m.sku[l]!, locationId: france, delta: n, note: 'Counted.' }, staff);

    // No size saved: the size with the most stock (52), its unit reserved at once.
    const won = await winFree(m.id);
    expect(won.reveal).toMatchObject({ kind: 'PRODUCT', prize: m.name, line: 'Yours, free. In YOUR ORDERS.', where: 'ORDERS', rare: false });
    expect(won.row).toMatchObject({ order_id: won.order!.id, value_minor: 90_000, currency: 'EUR', cost_minor: null, offer_until: null });
    expect(won.order).toMatchObject({
      channel: 'VAULT', vault_id: won.v.id, account_id: won.a.id, model_id: m.id, sku_id: m.sku['52'], size_label: '52', price_minor: 0, currency: 'EUR',
      status: 'RESERVED', reservation: 'STOCK', drop_id: null, with_order_id: null, location_id: france, shipping_service: 'STANDARD', shipping_minor: 0, shipping_benefit: null,
      claim_by: vaultRewardUntil(won.now),
    });
    expect(await level(m.sku['52']!)).toBe(2);
    expect(await receipt(won.v.id)).toEqual([{ title: 'FROM THE VAULT', body: `Your vault held ${m.name} · Yours, free. In YOUR ORDERS. It is in YOUR ORDERS.` }]);
    const created = await t.db.selectFrom('order_events').select(['actor_type', 'actor_id', 'details']).where('order_id', '=', won.order!.id).where('action', '=', 'order.create').executeTakeFirstOrThrow();
    expect(created).toMatchObject({ actor_type: 'account', actor_id: won.a.id, details: { vaultId: won.v.id, skuId: m.sku['52'], reservation: 'STOCK' } });
    expect((await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'vault.open').where('target_id', '=', won.v.id).executeTakeFirstOrThrow()).details).toMatchObject({ kind: 'PRODUCT', orderId: won.order!.id });

    // YOUR SIZES preselects among the sizes with stock (54, though 52 has more); a saved size with none left: the most.
    expect((await winFree(m.id, 54)).order).toMatchObject({ sku_id: m.sku['54'], size_label: '54' });
    await ctx.services.stock.adjust({ skuId: m.sku['50']!, locationId: france, delta: -1, note: 'Damaged.' }, staff);
    expect((await winFree(m.id, 50)).order).toMatchObject({ sku_id: m.sku['52'] });
    // Every order of other channels as before: a VAULT order travels alone and takes no free add-on or welcome gift.
    expect(await t.db.selectFrom('orders').select('id').where('with_order_id', '=', won.order!.id).execute()).toEqual([]);
    expect(await unitsOf(won.order!.id)).toEqual([]);
  });

  it('the claim: a size sold out in other channels after the win still lets the winner claim; a size changed only to one with stock; the address asked; then PAID at 0', async () => {
    const m = await stockedModel('ORBITE', { '52': 1, '54': 0 });
    await only({ kind: 'PRODUCT', modelId: m.id, mode: 'FREE' });
    const won = await winFree(m.id);
    expect(won.order).toMatchObject({ sku_id: m.sku['52'], reservation: 'STOCK' });
    // Sold out in another channel since: nothing left in 52 for anyone else, the winner's unit kept.
    await ctx.services.stock.adjust({ skuId: m.sku['52']!, locationId: france, delta: 2, note: 'Counted.' }, staff);
    await ctx.services.stock.adjust({ skuId: m.sku['52']!, locationId: france, delta: -2, note: 'Sold at the counter.' }, staff);
    expect(await level(m.sku['52']!)).toBe(0);
    expect(await vault().claimSizes(won.a.id, won.order!.id)).toEqual({
      orderId: won.order!.id, claimBy: won.order!.claim_by, claimDay: parisDay(won.order!.claim_by!), claimed: false, sizeFixed: false, size: '52',
      sizes: [{ label: '52', current: true, available: true }, { label: '54', current: false, available: false }],
    });
    // Another account's order, an order of another channel: not found.
    await expect(vault().claim((await createAccount(t.db)).id, won.order!.id)).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND', httpStatus: 404 });
    // No address yet (no default one): asked.
    await expect(vault().claim(won.a.id, won.order!.id)).rejects.toMatchObject({ code: 'ORDER_ADDRESS_MISSING', httpStatus: 409 });
    // A size with none left: refused, the order as it was; an unknown size: 400.
    await expect(vault().claim(won.a.id, won.order!.id, { size: '54', address: { address: PARIS } })).rejects.toMatchObject({ code: 'VAULT_SIZE_NONE_LEFT', httpStatus: 409 });
    await expect(vault().claim(won.a.id, won.order!.id, { size: '61' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await orderOf(won.order!.id)).toMatchObject({ status: 'RESERVED', sku_id: m.sku['52'], reservation: 'STOCK', buyer_name: null });
    // Claimed in its own size with its address: PAID at 0, its invoice, still holding its unit (ready to pack).
    clock.advance(MINUTE);
    expect(await vault().claim(won.a.id, won.order!.id, { address: { address: PARIS } })).toEqual({ orderId: won.order!.id, claimed: true });
    const paid = await orderOf(won.order!.id);
    expect(paid).toMatchObject({ status: 'PAID', paid_at: clock.now(), sku_id: m.sku['52'], reservation: 'STOCK', buyer_name: PARIS.name, buyer_country: 'FR', address_by: 'COLLECTOR' });
    const invoice = await t.db.selectFrom('invoices').selectAll().where('order_id', '=', paid.id).where('kind', '=', 'INVOICE').executeTakeFirstOrThrow();
    expect(linesOf(invoice.lines).map((l) => [l.kind, l.detail, l.amountMinor])).toEqual([
      ['PIECE', 'THE VAULT', 0],
      ['SHIPPING', null, 0],
    ]);
    expect(await t.db.selectFrom('audit_logs').select(['actor_type', 'details']).where('action', '=', 'vault.claim').where('target_id', '=', won.v.id).execute()).toEqual([
      { actor_type: 'account', details: { orderId: paid.id, skuId: m.sku['52'], sizeChanged: false } },
    ]);
    // Claimed already: nothing changes.
    expect(await vault().claim(won.a.id, won.order!.id, { size: '54' })).toEqual({ orderId: won.order!.id, claimed: true });
    expect(await orderOf(won.order!.id)).toMatchObject({ status: 'PAID', sku_id: m.sku['52'] });

    // Another winner changes the size to one with stock: the reserved unit swaps, the first back to stock.
    await ctx.services.stock.adjust({ skuId: m.sku['52']!, locationId: france, delta: 1, note: 'Counted.' }, staff);
    const other = await winFree(m.id);
    expect(other.order).toMatchObject({ sku_id: m.sku['52'] });
    await ctx.services.stock.adjust({ skuId: m.sku['54']!, locationId: france, delta: 1, note: 'Counted.' }, staff);
    await vault().claim(other.a.id, other.order!.id, { size: ' 54 ', address: { address: PARIS, save: true } });
    expect(await orderOf(other.order!.id)).toMatchObject({ status: 'PAID', sku_id: m.sku['54'], size_label: '54', reservation: 'STOCK' });
    expect([await level(m.sku['52']!), await level(m.sku['54']!)]).toEqual([1, 0]);
    expect((await t.db.selectFrom('order_events').select('details').where('order_id', '=', other.order!.id).where('action', '=', 'order.size').executeTakeFirstOrThrow()).details).toEqual({
      by: 'collector', from: m.sku['52'], skuId: m.sku['54'], reservation: 'STOCK',
    });
    expect(await t.db.selectFrom('account_addresses').select('name').where('account_id', '=', other.a.id).execute()).toEqual([{ name: PARIS.name }]);
  });

  it('Client Services on a VAULT order: at 0 and unclaimed, its location, size and price refused in words, its unit kept; claimed, moved or resized only where a unit of its size is; a right to buy keeps a price', async () => {
    const m = await stockedModel('CLAIRE', { '52': 2, '54': 1 });
    await only({ kind: 'PRODUCT', modelId: m.id, mode: 'FREE' });
    const won = await winFree(m.id);
    const id = won.order!.id;
    const held = { status: 'RESERVED', sku_id: m.sku['52'], reservation: 'STOCK', location_id: france, price_minor: 0 };
    expect(won.order).toMatchObject(held);
    const studio = (await ctx.services.stock.createLocation({ name: `STUDIO ${randomUUID().slice(0, 6)}` }, staff)).id;
    // Unclaimed (0062's orders_vault): refused in words, never a raw error; the order and its unit as they were.
    const unclaimed = { code: 'ORDER_VAULT_UNCLAIMED', httpStatus: 409, message: 'A piece won in a vault keeps the unit held for its winner until it is claimed: its location, size and price do not change before.' };
    await expect(orders().changeLocation(id, studio, staff)).rejects.toMatchObject(unclaimed);
    await expect(orders().setTerms(id, { sizeLabel: '54' }, staff)).rejects.toMatchObject(unclaimed);
    await expect(orders().setTerms(id, { priceMinor: 50_000, currency: 'EUR' }, staff)).rejects.toMatchObject(unclaimed);
    expect(await orderOf(id)).toMatchObject(held);
    expect(await level(m.sku['52']!)).toBe(1);
    // Claimed: moved only where a unit of its size is, never waiting for stock.
    await vault().claim(won.a.id, id, { address: { address: PARIS } });
    const noUnit = { code: 'ORDER_VAULT_NO_UNIT', httpStatus: 409 };
    await expect(orders().changeLocation(id, studio, staff)).rejects.toMatchObject(noUnit);
    expect(await orderOf(id)).toMatchObject({ ...held, status: 'PAID' });
    await ctx.services.stock.adjust({ skuId: m.sku['52']!, locationId: studio, delta: 1, note: 'Counted.' }, staff);
    await orders().changeLocation(id, studio, staff);
    expect(await orderOf(id)).toMatchObject({ status: 'PAID', location_id: studio, sku_id: m.sku['52'], reservation: 'STOCK' });
    await expect(orders().setTerms(id, { sizeLabel: '54' }, staff)).rejects.toMatchObject(noUnit);
    await ctx.services.stock.adjust({ skuId: m.sku['54']!, locationId: studio, delta: 1, note: 'Counted.' }, staff);
    await orders().setTerms(id, { sizeLabel: '54' }, staff);
    expect(await orderOf(id)).toMatchObject({ status: 'PAID', location_id: studio, sku_id: m.sku['54'], reservation: 'STOCK', price_minor: 0 });

    // A right to buy's VAULT order: its price changes as any order's, never to 0 (that is a piece won free).
    await only({ kind: 'PRODUCT', modelId: m.id, mode: 'RIGHT_TO_BUY' });
    const a = await createAccount(t.db);
    const v = await houseVault(a.id);
    await opener.open(a.id, v.id);
    const { orderId } = await vault().buy(a.id, v.id, { size: '52' });
    await expect(orders().setTerms(orderId, { priceMinor: 0, currency: 'EUR' }, staff)).rejects.toMatchObject({ code: 'ORDER_VAULT_PRICE', httpStatus: 409 });
    await expect(orders().setTerms(orderId, { priceMinor: null, currency: null }, staff)).rejects.toMatchObject({ code: 'ORDER_VAULT_PRICE' });
    await orders().setTerms(orderId, { priceMinor: 85_000, currency: 'EUR' }, staff);
    expect(await orderOf(orderId)).toMatchObject({ channel: 'VAULT', price_minor: 85_000, claim_by: null, status: 'RESERVED' });
  });

  it('unclaimed at its claim_by: the housekeeping job vaults cancels it and its reserved unit goes back to stock; a claim after its end is refused', async () => {
    const m = await stockedModel('HALO', { '52': 1 });
    await only({ kind: 'PRODUCT', modelId: m.id, mode: 'FREE' });
    const won = await winFree(m.id);
    expect(await level(m.sku['52']!)).toBe(0);
    const end = won.order!.claim_by!;
    // Before its end: nothing.
    expect(await vault().expireClaims(new Date(end.getTime() - MINUTE))).toBe(0);
    // At its end, before the pass: the claim is refused.
    await expect(vault().claim(won.a.id, won.order!.id, { address: { address: PARIS } }, end)).rejects.toMatchObject({ code: 'VAULT_OFFER_ENDED', httpStatus: 409, message: 'The 30 days to claim it are over.' });
    // The pass after its end: CANCELLED by the system, its unit back to stock.
    clock.set(new Date(end.getTime() + MINUTE));
    // (The earlier tests' pieces won and never claimed end with it.)
    const due = await t.db.selectFrom('orders').select('id').where('channel', '=', 'VAULT').where('status', '=', 'RESERVED').where('claim_by', '<=', clock.now()).execute();
    expect(due.map((o) => o.id)).toContain(won.order!.id);
    const hk = startHousekeeping(ctx, { intervalMs: 3_600_000 });
    const pass = await hk.runOnce();
    await hk.stop();
    expect(pass.vaults).toBe(due.length);
    expect(await orderOf(won.order!.id)).toMatchObject({ status: 'CANCELLED', reservation: null, cancelled_at: clock.now() });
    expect(await level(m.sku['52']!)).toBe(1);
    expect(await t.db.selectFrom('order_events').select(['note', 'actor_type']).where('order_id', '=', won.order!.id).where('action', '=', 'order.cancel').execute()).toEqual([{ note: 'Not claimed within 30 days.', actor_type: 'system' }]);
    expect(await t.db.selectFrom('audit_logs').select(['actor_type', 'details']).where('action', '=', 'vault.claim_expired').where('target_id', '=', won.v.id).execute()).toEqual([
      { actor_type: 'system', details: { orderId: won.order!.id, skuId: m.sku['52'] } },
    ]);
    await expect(vault().claim(won.a.id, won.order!.id, { address: { address: PARIS } })).rejects.toMatchObject({ code: 'VAULT_OFFER_ENDED' });
    expect(await vault().expireClaims()).toBe(0);
    // The vault keeps what it held: its order, cancelled.
    expect((await vaultRow(won.v.id)).order_id).toBe(won.order!.id);
  });

  it('RIGHT TO BUY a model: BUY within 24 hours creates a VAULT order at its usual price, held as any order; once; after 24 hours refused', async () => {
    const m = await stockedModel('ORBIS', { '52': 1, '54': 0 }, 120_000);
    await only({ kind: 'PRODUCT', modelId: m.id, mode: 'RIGHT_TO_BUY' });
    const a = await createAccount(t.db);
    const v = await houseVault(a.id);
    const now = clock.now();
    expect(await opener.open(a.id, v.id)).toMatchObject({ kind: 'PRODUCT', prize: m.name, line: 'Yours to buy at its price, for 24 hours.', where: 'ORDERS' });
    expect(await vaultRow(v.id)).toMatchObject({ offer_until: new Date(now.getTime() + 24 * HOUR), order_id: null });
    // Nothing reserved before BUY.
    expect(await level(m.sku['52']!)).toBe(1);
    expect(await vault().rightsToBuy(a.id)).toEqual([{ vaultId: v.id, modelId: m.id, name: m.name, priceMinor: 120_000, currency: 'EUR', offerUntil: new Date(now.getTime() + 24 * HOUR), sizes: ['52', '54'] }]);
    await expect(vault().buy(a.id, v.id)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(vault().buy((await createAccount(t.db)).id, v.id, { size: '52' })).rejects.toMatchObject({ code: 'VAULT_NOT_FOUND', httpStatus: 404 });
    clock.advance(HOUR);
    const { orderId } = await vault().buy(a.id, v.id, { size: '52' });
    expect(await orderOf(orderId)).toMatchObject({ channel: 'VAULT', vault_id: v.id, model_id: m.id, sku_id: m.sku['52'], price_minor: 120_000, currency: 'EUR', claim_by: null, status: 'RESERVED', reservation: 'STOCK' });
    expect(await vaultRow(v.id)).toMatchObject({ order_id: orderId, offer_used_at: clock.now() });
    expect(await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'vault.buy').where('target_id', '=', v.id).execute()).toEqual([
      { details: { orderId, modelId: m.id, skuId: m.sku['52'], priceMinor: 120_000, currency: 'EUR' } },
    ]);
    // Once: BUY again reads its order; the right no longer listed.
    expect(await vault().buy(a.id, v.id, { size: '54' })).toEqual({ orderId });
    expect(await vault().rightsToBuy(a.id)).toEqual([]);
    // Paid as every platform order (Client Services marks it PAID).
    await orders().transition(orderId, { to: 'PAID' }, staff);
    expect((await orderOf(orderId)).status).toBe('PAID');

    // After its 24 hours: refused, nothing created.
    const b = await createAccount(t.db);
    const w = await houseVault(b.id);
    await opener.open(b.id, w.id);
    clock.advance(24 * HOUR);
    await expect(vault().buy(b.id, w.id, { size: '54' })).rejects.toMatchObject({ code: 'VAULT_OFFER_ENDED', httpStatus: 409, message: 'The 24 hours to buy it are over.' });
    expect(await t.db.selectFrom('orders').select('id').where('vault_id', '=', w.id).execute()).toEqual([]);
    // A vault that is no right to buy: not found.
    await only({});
    const c = await houseVault(b.id);
    await opener.open(b.id, c.id);
    await expect(vault().buy(b.id, c.id)).rejects.toMatchObject({ code: 'VAULT_NOT_FOUND' });
  });

  it('RIGHT TO BUY an add-on: ADD on an order before packing, at its price, its YOUR ORDERS switch off, within 24 hours, once', async () => {
    await t.db.updateTable('addon_items').set({ offer_orders: false }).where('id', '=', cloth.id).execute();
    await ctx.services.stock.adjust({ skuId: cloth.skuId, locationId: france, delta: 3, note: 'Counted.' }, staff);
    await only({ kind: 'PRODUCT', addonId: cloth.id, mode: 'RIGHT_TO_BUY' });
    const a = await createAccount(t.db);
    const v = await houseVault(a.id);
    const now = clock.now();
    await opener.open(a.id, v.id);
    const id = await salonOrder(a.id, 300_000);
    const offered = (await ctx.services.orderAddons.offerForAccount(a.id, id)).offer.find((o) => o.addonId === cloth.id);
    expect(offered).toEqual({ addonId: cloth.id, name: 'POLISHING CLOTH', line: null, priceMinor: 1_500, currency: 'EUR', maxUnits: 1, engraving: false, vaultUntil: new Date(now.getTime() + 24 * HOUR) });
    await expect(ctx.services.orderAddons.addForAccount(a.id, id, { addonId: cloth.id, units: 2 }, a.actor)).rejects.toMatchObject({ code: 'ADDON_LIMIT' });
    clock.advance(MINUTE);
    await ctx.services.orderAddons.addForAccount(a.id, id, { addonId: cloth.id, units: 1 }, a.actor);
    expect((await unitsOf(id)).map((u) => [u.addon_id, u.price_minor, u.added_by_type, u.vault_id, u.status])).toEqual([[cloth.id, 1_500, 'COLLECTOR', null, 'HELD']]);
    expect((await vaultRow(v.id)).offer_used_at).toEqual(clock.now());
    expect((await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'vault.buy').where('target_id', '=', v.id).executeTakeFirstOrThrow()).details).toMatchObject({ orderId: id, addonId: cloth.id, priceMinor: 1_500, currency: 'EUR' });
    // Once: its switch off, no longer offered nor added.
    expect((await ctx.services.orderAddons.offerForAccount(a.id, id)).offer.find((o) => o.addonId === cloth.id)).toBeUndefined();
    await expect(ctx.services.orderAddons.addForAccount(a.id, id, { addonId: cloth.id, units: 1 }, a.actor)).rejects.toMatchObject({ code: 'ADDON_NOT_OFFERED' });
    // After its 24 hours: none.
    const b = await createAccount(t.db);
    const w = await houseVault(b.id);
    await opener.open(b.id, w.id);
    const other = await salonOrder(b.id, 300_000);
    clock.advance(24 * HOUR);
    expect((await ctx.services.orderAddons.offerForAccount(b.id, other)).offer.find((o) => o.addonId === cloth.id)).toBeUndefined();
    await expect(ctx.services.orderAddons.addForAccount(b.id, other, { addonId: cloth.id, units: 1 }, b.actor)).rejects.toMatchObject({ code: 'ADDON_NOT_OFFERED' });
    await t.db.updateTable('addon_items').set({ offer_orders: true }).where('id', '=', cloth.id).execute();
  });

  it('THE PIECE: the missed model in the entry’s size, its unit reserved at the opening from stock outside the release; its size never changes at the claim', async () => {
    const ring = await stockedModel('ANNEAU', { '52': 1, '54': 3 });
    await only({ kind: 'THE_PIECE' });
    const a = await createAccount(t.db);
    const start = clock.now();
    const r = await createLiveRelease(f, { modelId: ring.id, opensAt: new Date(start.getTime() + HOUR), sizes: [{ label: '52', stock: 1 }] });
    await t.db.updateTable('drops').set({ vault_on: true }).where('id', '=', r.id).execute();
    clock.set(new Date(start.getTime() + HOUR - MINUTE));
    await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
    const entry = await t.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', a.id).executeTakeFirstOrThrow();
    const v = (await vault().give({ source: 'LIVE', accountId: a.id, dropId: r.id, entryId: entry.id })).vaults[0]!;
    expect(await opener.open(a.id, v.id)).toMatchObject({ kind: 'THE_PIECE', prize: 'THE PIECE', line: `${ring.name}, size 52. Free.`, rare: true, where: 'ORDERS' });
    const row = await vaultRow(v.id);
    // The entry's size, never the size with the most stock.
    const o = await orderOf(row.order_id!);
    expect(o).toMatchObject({ channel: 'VAULT', model_id: ring.id, sku_id: ring.sku['52'], size_label: '52', price_minor: 0, reservation: 'STOCK', drop_id: null });
    expect(await level(ring.sku['52']!)).toBe(0);
    expect(await vault().claimSizes(a.id, o.id)).toMatchObject({ sizeFixed: true, size: '52', sizes: [{ label: '52', current: true, available: true }, { label: '54', current: false, available: false }] });
    await expect(vault().claim(a.id, o.id, { size: '54', address: { address: PARIS } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: 'THE PIECE comes in your size: its size does not change.' });
    await vault().claim(a.id, o.id, { size: '52', address: { address: PARIS } });
    expect(await orderOf(o.id)).toMatchObject({ status: 'PAID', sku_id: ring.sku['52'] });
  });

  it('VAULT EDITION: a VAULT order at 0 of its vault-only model, rare, revealed as VAULT EDITION with its own line', async () => {
    const edition = await stockedModel('EDITION', { '52': 1 });
    await t.db.updateTable('models').set({ vault_only: true }).where('id', '=', edition.id).execute();
    await only({ kind: 'VAULT_EDITION', modelId: edition.id, line: 'Made only for the vault, never sold.' });
    const won = await winFree(edition.id);
    // The reveal says the kind (the reference's "VAULT EDITION"); the model is the VAULT order's.
    expect(won.reveal).toMatchObject({ kind: 'VAULT_EDITION', prize: 'VAULT EDITION', line: 'Made only for the vault, never sold.', rare: true, where: 'ORDERS' });
    expect(won.order).toMatchObject({ channel: 'VAULT', model_id: edition.id, sku_id: edition.sku['52'], price_minor: 0, reservation: 'STOCK' });
    // None left: the card.
    expect((await winFree(edition.id)).reveal).toMatchObject({ kind: 'I_WAS_THERE' });
  });

  it('a vault-only model is refused by every sales path (a draw, a LIVE release and its after-room, the salon, YOUR WISHLIST, the Shopify export and its sets) and still listed in the lookbook', async () => {
    const vo = await stockedModel('SECRET', { '52': 1 });
    const slug = `vo-${randomUUID().slice(0, 8)}`;
    await t.db.updateTable('models').set({ vault_only: true, slug, lookbook: 'PUBLIC', published_at: new Date('2026-01-01T00:00:00Z'), private_min_tier: 1 }).where('id', '=', vo.id).execute();
    const opensAt = new Date(clock.now().getTime() + 2 * DAY);
    const closesAt = new Date(opensAt.getTime() + HOUR);
    // A draw.
    await expect(ctx.services.drops.create({ modelId: vo.id, title: 'A DRAW', opensAt, closesAt, earlyAccessHours: 0, sizes: [{ label: '52', pieces: 2 }] } as never, staff)).rejects.toMatchObject({ code: 'MODEL_VAULT_ONLY', httpStatus: 409 });
    // A LIVE release; one created before its model was made vault-only, at its publication; an after-room.
    const live = { pace: { batch: 5000, minutes: 1 }, holdMinutes: 0, title: 'THE RING', opensAt, closesAt, priceMinor: 100_000, sizes: [{ label: '52', stock: 2 }] };
    await expect(f.liveConsole.create({ ...live, modelId: vo.id } as never, staff)).rejects.toMatchObject({ code: 'MODEL_VAULT_ONLY' });
    const later = await stockedModel('LATER', { '52': 0 });
    const created = await f.liveConsole.create({ ...live, modelId: later.id } as never, staff);
    await t.db.updateTable('models').set({ vault_only: true }).where('id', '=', later.id).execute();
    await expect(f.liveConsole.publish(created.id, {}, staff)).rejects.toMatchObject({ code: 'MODEL_VAULT_ONLY' });
    await t.db.updateTable('models').set({ vault_only: false }).where('id', '=', later.id).execute();
    await expect(f.liveConsole.update(created.id, { afterRoom: { modelId: vo.id, priceMinor: 100_000, sizes: [{ label: '52', stock: 1 }], addonIds: [] } } as never, staff)).rejects.toMatchObject({ code: 'MODEL_VAULT_ONLY' });
    // YOUR WISHLIST.
    const a = await createAccount(t.db);
    await expect(ctx.services.wishlist.add(a.id, slug)).rejects.toMatchObject({ code: 'MODEL_VAULT_ONLY' });
    // The lookbook is no sales path: listed as any PUBLIC model.
    expect((await ctx.services.lookbook.listPublic()).map((c) => c.slug)).toContain(slug);
    // The salon: a RESERVED model, shown to its tier, never requested.
    await t.db.updateTable('models').set({ lookbook: 'RESERVED' }).where('id', '=', vo.id).execute();
    await holdPieces(t.db, a.id, 1, f.modelId);
    expect((await ctx.services.lookbook.listReserved(1)).map((c) => c.slug)).toContain(slug);
    await expect(ctx.services.salon.request(a.id, slug, null, a.actor)).rejects.toMatchObject({ code: 'MODEL_VAULT_ONLY' });
    // The Shopify export: never one of its sellable lines, nor a set holding it; the same model not vault-only is, and its set.
    const skuCode = (await t.db.selectFrom('skus').select('code').where('id', '=', vo.sku['52']!).executeTakeFirstOrThrow()).code;
    const setCode = `VO-${randomUUID().slice(0, 6).toUpperCase()}`;
    await ctx.services.sets.create({ name: 'The Secret Pair', code: setCode, modelIds: [vo.id, later.id], basePriceMinor: 150_000, baseCurrency: 'EUR' }, staff);
    const sealed = (await ctx.services.shopify.productCsv('EUR')).body;
    expect(sealed).not.toContain(skuCode);
    expect(sealed).not.toContain(setCode);
    await t.db.updateTable('models').set({ vault_only: false }).where('id', '=', vo.id).execute();
    const open = (await ctx.services.shopify.productCsv('EUR')).body;
    expect(open).toContain(skuCode);
    expect(open).toContain(setCode);
  });
});
