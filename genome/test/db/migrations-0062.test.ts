/**
 * Migration 0062_vault_rewards (lot Q3, step Q3.2; plan §1.2, §1.3): the links from a vault into the systems that deliver
 * what it held, on PGlite here and on a real PostgreSQL in genome-ci (ORBES_TEST_POSTGRES_URL, a throwaway database;
 * skipped without it), the same cases on both:
 *  - down to 0061 without rows: exactly the schema of 0061 (PGlite: against a database migrated to 0061 alone), what it
 *    added beside its own table, and up again the latest;
 *  - a vault's credit (`tier_grants` kind VAULT: its vault, no tier, amount, currency and expiry; once per vault;
 *    `usable_while_no_piece` on a VAULT grant only);
 *  - a VAULT order (its vault, no release, travelling with no order, piece 1, its SKU and price; at 0 its 30 days to be
 *    claimed and the unit reserved for the winner, never waiting for stock, its SKU changeable; under a right to buy at
 *    its price, no claim; one open per vault);
 *  - a LIVE guarantee (its vault, no release, model nor collection; once per vault), and the staff's three scopes;
 *  - the vault's free add-on (a unit of source VAULT, its vault, at price 0, no one named; one unit per vault, a removed
 *    one aside);
 *  - a credit to give (`vault_gifts`: its vault once, the code's HMAC once, 30 days, accepted once with its grant, its
 *    identity fixed, never deleted);
 *  - a vault's gift and offer (none before the opening; an offer on an ADDON or PRODUCT reward, after the opening, used
 *    within it and once; the offer's end written with the outcome; the gift linked once);
 *  - down refused while any of them exists, naming the counts.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { createMigrator, migrateToLatest } from '../../src/server/db/migrate.js';
import { isCheckViolation, isGuardViolation, isUniqueViolation } from '../../src/server/db/pg-errors.js';
import { GRANTED_GUARANTEE_SCOPES, GUARANTEE_SCOPES, VAULT_GIFT_CODE_HASH_BYTES, VAULT_GIFT_DAYS } from '../../src/server/db/schema.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { createAccount, createLiveRelease, liveFixture } from '../support/live.js';

const BEFORE = '0061_the_vault';
const NAME = '0062_vault_rewards';
/** The migration after it (lot M4, step M4.1: the margin's settings), taken down first and applied again with it. */
const LATER = '0063_margin';
const DAY = 86_400_000;
const HOUR = 3_600_000;
const pgUrl = process.env.ORBES_TEST_POSTGRES_URL;

/** Every column, index, constraint and trigger of the public schema (as test/db/migrations.test.ts reads it). */
async function snapshotOf(db: Kysely<any>): Promise<string[]> {
  return (
    await sql<{ object: string }>`
      SELECT 'table ' || table_name || ' ' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') AS object
        FROM information_schema.columns WHERE table_schema = 'public' AND table_name NOT LIKE 'kysely_%'
      UNION ALL SELECT 'index ' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename NOT LIKE 'kysely_%'
      UNION ALL SELECT 'constraint ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
        FROM pg_constraint WHERE connamespace = 'public'::regnamespace
      UNION ALL SELECT 'trigger ' || tgrelid::regclass::text || ' ' || tgname FROM pg_trigger WHERE NOT tgisinternal
      ORDER BY 1`.execute(db)
  ).rows.map((r) => r.object);
}

/** The body of the vaults' guard, which the snapshot does not read. */
async function guardOf(db: Kysely<any>): Promise<string> {
  return (await sql<{ src: string }>`SELECT prosrc AS src FROM pg_proc WHERE proname = 'orbes_vaults_guard'`.execute(db)).rows[0]!.src;
}

/** Down to 0061 (0063, then 0062, reverted). */
async function downTo0061(db: Db): Promise<string[]> {
  const rs = await createMigrator(db).migrateTo(BEFORE);
  if (rs.error) throw rs.error;
  return (rs.results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}

/**
 * The cases, on a database at the latest migration with no business data. They run in order: the down to 0061 without
 * rows first, then the rows, then the down refused.
 */
function cases(state: { db: () => Db; schemaAt0061: () => Promise<{ schema: string[]; guard: string } | null> }) {
  const db = () => state.db();

  /** An account, a model's SKU and an add-on's, a location, and a vault opened (or not) for that account. */
  async function setup(start: string) {
    const f = await liveFixture(db(), start);
    const account = await createAccount(db());
    const friend = await createAccount(db());
    const tag = randomUUID().slice(0, 8).toUpperCase();
    const location = await db().insertInto('stock_locations').values({ name: `VAULT V0062 ${tag}` }).returning('id').executeTakeFirstOrThrow();
    const size52 = await db().insertInto('skus').values({ model_id: f.modelId, size_label: '52', code: `V62-${tag}-52` }).returning('id').executeTakeFirstOrThrow();
    const size54 = await db().insertInto('skus').values({ model_id: f.modelId, size_label: '54', code: `V62-${tag}-54` }).returning('id').executeTakeFirstOrThrow();
    const addon = await db().insertInto('addon_items').values({ name: `TRAVEL CASE V0062 ${tag}` }).returning('id').executeTakeFirstOrThrow();
    const addonSku = await db().insertInto('skus').values({ addon_id: addon.id, code: `V62-${tag}-CASE` }).returning('id').executeTakeFirstOrThrow();
    const floor = await db().selectFrom('vault_rewards').select('id').where('kind', '=', 'I_WAS_THERE').executeTakeFirstOrThrow();
    let n = 0;
    const given = new Date(new Date(start).getTime() - 2 * DAY);
    /** A HOUSE vault of `account`; opened with `kind`'s outcome when given. */
    const vault = async (kind?: string, opened: Record<string, unknown> = {}) => {
      const v = await db()
        .insertInto('vaults')
        .values({ account_id: account.id, source: 'HOUSE', given_by: f.admin.id, occasion_key: `HOUSE:${randomUUID()}`, occasion_index: 1, given_at: given, waits_until: new Date(given.getTime() + 30 * DAY) } as never)
        .returning('id')
        .executeTakeFirstOrThrow();
      n++;
      if (kind) {
        await db()
          .updateTable('vaults')
          .set({ opened_at: new Date(given.getTime() + DAY), reward_id: floor.id, reward_kind: kind, prize: `PRIZE ${n}`, odds_text: '1 IN 200', rare: false, ...opened } as never)
          .where('id', '=', v.id)
          .execute();
      }
      return v.id;
    };
    return { f, account, friend, location, size52, size54, addon, addonSku, vault, openedAt: new Date(given.getTime() + DAY) };
  }

  it('rolls back to the schema of 0061 exactly without rows, and applies again to the latest', async () => {
    const latest = await snapshotOf(db());
    const latestGuard = await guardOf(db());
    expect(latestGuard).toContain('offer_until');
    // 0063 down first: the schema 0062 left, which this case reads.
    const rs = await createMigrator(db()).migrateTo(NAME);
    if (rs.error) throw rs.error;
    const at0062 = await snapshotOf(db());
    expect(await downTo0061(db())).toEqual([NAME]);
    const without = await snapshotOf(db());
    expect(without.filter((o) => /vault_gifts|offer_until|offer_used_at|claim_by|usable_while_no_piece/.test(o))).toEqual([]);
    expect(await guardOf(db())).not.toContain('offer_until');
    const at0061 = await state.schemaAt0061();
    if (at0061) {
      expect(without).toEqual(at0061.schema);
      expect(await guardOf(db())).toEqual(at0061.guard);
    }
    // What 0062 added beside its own table: its columns on the four systems that deliver a reward and on vaults.
    const added = at0062.filter((o) => !without.includes(o));
    expect(added.filter((o) => o.startsWith('table ') && !o.startsWith('table vault_gifts ')).sort()).toEqual([
      'table house_guarantees vault_id uuid YES ',
      'table order_addon_items vault_id uuid YES ',
      'table orders claim_by timestamp with time zone YES ',
      'table orders vault_id uuid YES ',
      'table tier_grants usable_while_no_piece boolean NO false',
      'table tier_grants vault_id uuid YES ',
      'table vaults gift_id uuid YES ',
      'table vaults offer_until timestamp with time zone YES ',
      'table vaults offer_used_at timestamp with time zone YES ',
    ]);
    expect(added.filter((o) => o.startsWith('trigger ')).sort()).toEqual([
      'trigger vault_gifts vault_gifts_accepted_once',
      'trigger vault_gifts vault_gifts_immutable_identity',
      'trigger vault_gifts vault_gifts_no_delete',
    ]);
    // The constraints it widened or added on the other tables, by name (a NOT NULL's own entry left out: PGlite's
    // PostgreSQL lists it among the constraints, PostgreSQL 16 does not).
    const names = (list: string[]) =>
      list.filter((o) => o.startsWith('constraint ') && !o.startsWith('constraint vault_gifts ') && !/_not_null NOT NULL /.test(o)).map((o) => o.split(' ').slice(1, 3).join(' ')).sort();
    expect(names(added)).toEqual([
      'house_guarantees house_guarantees_scope',
      'house_guarantees house_guarantees_scope_check',
      'house_guarantees house_guarantees_vault_id_fkey',
      'house_guarantees house_guarantees_vault_key',
      'order_addon_items order_addon_items_added_by',
      'order_addon_items order_addon_items_added_by_type_check',
      'order_addon_items order_addon_items_vault',
      'order_addon_items order_addon_items_vault_id_fkey',
      'orders orders_channel_check',
      'orders orders_source',
      'orders orders_vault',
      'orders orders_vault_id_fkey',
      'tier_grants tier_grants_birthday',
      'tier_grants tier_grants_credit',
      'tier_grants tier_grants_kind_check',
      'tier_grants tier_grants_vault',
      'tier_grants tier_grants_vault_id_fkey',
      'tier_grants tier_grants_vault_key',
      'vaults vaults_gift_id_fkey',
      'vaults vaults_offer',
      'vaults vaults_outcome',
    ]);
    expect((await migrateToLatest(db())).applied).toEqual([NAME, LATER]);
    expect(await snapshotOf(db())).toEqual(latest);
    expect(await guardOf(db())).toEqual(latestGuard);
  });

  it('holds a vault\'s credit: kind VAULT with its vault, no tier, an amount, currency and expiry; once per vault; usable while no piece on a VAULT grant only; never changed', async () => {
    const { account, friend, vault } = await setup('2026-11-20T10:00:00.000Z');
    const v = await vault('CREDIT');
    const gift = await vault('CREDIT_TO_GIVE');
    const credit = { account_id: account.id, kind: 'VAULT', amount_minor: 2500, currency: 'EUR', granted_at: new Date('2026-11-20T10:00:00Z'), expires_at: new Date('2026-12-20T22:59:59Z') };
    const grant = (v: Record<string, unknown>) => db().insertInto('tier_grants').values(v as never).returning(['id', 'tier', 'usable_while_no_piece']).executeTakeFirstOrThrow();
    await expect(grant({ ...credit })).rejects.toSatisfy((e) => isCheckViolation(e, 'tier_grants_vault'));
    await expect(grant({ ...credit, vault_id: v, tier: 2 })).rejects.toSatisfy((e) => isCheckViolation(e, 'tier_grants_birthday'));
    await expect(grant({ ...credit, vault_id: v, amount_minor: null, currency: null, expires_at: null })).rejects.toSatisfy((e) => isCheckViolation(e, 'tier_grants_credit'));
    await expect(grant({ ...credit, vault_id: v, expires_at: null })).rejects.toSatisfy((e) => isCheckViolation(e, 'tier_grants_credit'));
    await expect(grant({ account_id: account.id, kind: 'CREDIT', tier: 2, amount_minor: 2500, currency: 'EUR', expires_at: credit.expires_at, vault_id: v })).rejects.toSatisfy((e) => isCheckViolation(e, 'tier_grants_vault'));
    await expect(grant({ account_id: account.id, kind: 'CREDIT', tier: 2, amount_minor: 2500, currency: 'EUR', expires_at: credit.expires_at, usable_while_no_piece: true })).rejects.toSatisfy((e) => isCheckViolation(e, 'tier_grants_vault'));
    await expect(grant({ ...credit, kind: 'LOTTERY', vault_id: v })).rejects.toSatisfy((e) => isCheckViolation(e, 'tier_grants_kind_check') || isCheckViolation(e, 'tier_grants_birthday') || isCheckViolation(e, 'tier_grants_credit') || isCheckViolation(e, 'tier_grants_vault'));
    const won = await grant({ ...credit, vault_id: v });
    expect(won).toEqual({ id: expect.any(String), tier: null, usable_while_no_piece: false });
    // A delivery run twice gives one.
    await expect(grant({ ...credit, vault_id: v })).rejects.toSatisfy((e) => isUniqueViolation(e, 'tier_grants_vault_key'));
    // A credit given to a friend: on their account, usable while they hold no piece.
    const friends = await grant({ ...credit, account_id: friend.id, vault_id: gift, usable_while_no_piece: true });
    expect(friends.usable_while_no_piece).toBe(true);
    // Never changed: its vault, its use while no piece.
    await expect(sql`UPDATE tier_grants SET vault_id = ${gift} WHERE id = ${won.id}`.execute(db())).rejects.toSatisfy(isGuardViolation);
    await expect(sql`UPDATE tier_grants SET usable_while_no_piece = true WHERE id = ${won.id}`.execute(db())).rejects.toSatisfy(isGuardViolation);
    // The vault links it once (0061's guard).
    await db().updateTable('vaults').set({ grant_id: won.id }).where('id', '=', v).execute();
    await expect(db().updateTable('vaults').set({ grant_id: friends.id }).where('id', '=', v).execute()).rejects.toSatisfy(isGuardViolation);
    // The tiers' grants are unchanged.
    await grant({ account_id: account.id, kind: 'CREDIT', tier: 2, amount_minor: 2500, currency: 'EUR', expires_at: credit.expires_at });
  });

  it('holds a VAULT order: its vault, no release, travelling with no order, its SKU and price; at 0 its 30 days to claim and the unit reserved for the winner (its size changeable); one open per vault; its vault never changed', async () => {
    const { f, account, location, size52, size54, vault } = await setup('2026-11-21T10:00:00.000Z');
    const v = await vault('PRODUCT');
    const other = await vault('VAULT_EDITION');
    const bought = await vault('PRODUCT', { offer_until: new Date('2026-11-21T10:00:00.000Z') });
    const reservedAt = new Date('2026-11-20T10:00:00.000Z');
    const claimBy = new Date(reservedAt.getTime() + 30 * DAY);
    const free = { channel: 'VAULT', vault_id: v, account_id: account.id, model_id: f.modelId, location_id: location.id, sku_id: size52.id, size_label: '52', reservation: 'STOCK', price_minor: 0, currency: 'EUR', reserved_at: reservedAt, claim_by: claimBy };
    const order = (o: Record<string, unknown>) => db().insertInto('orders').values(o as never).returning(['id', 'status', 'piece', 'drop_id']).executeTakeFirstOrThrow();
    // Its own vault, and only a VAULT order names one.
    await expect(order({ ...free, vault_id: null })).rejects.toSatisfy((e) => isCheckViolation(e, 'orders_source'));
    const request = await db().insertInto('shop_requests').values({ account_id: account.id, model_id: f.modelId, status: 'CLOSED', created_at: new Date(Date.now() - 60_000), handled_at: new Date(), outcome: 'ACCEPTED' }).returning('id').executeTakeFirstOrThrow();
    await expect(order({ ...free, channel: 'SALON', shop_request_id: request.id, price_minor: 1000, claim_by: null })).rejects.toSatisfy((e) => isCheckViolation(e, 'orders_source'));
    // No release, travelling with no order, piece 1.
    const release = await createLiveRelease(f, { opensAt: new Date('2026-11-22T10:00:00Z') });
    await expect(order({ ...free, drop_id: release.id })).rejects.toSatisfy((e) => isCheckViolation(e, 'orders_source'));
    await expect(order({ ...free, piece: 2 })).rejects.toSatisfy((e) => isCheckViolation(e, 'orders_source'));
    // Its SKU and its price.
    await expect(order({ ...free, sku_id: null, reservation: null })).rejects.toSatisfy((e) => isCheckViolation(e, 'orders_vault'));
    await expect(order({ ...free, price_minor: null, currency: null, claim_by: null })).rejects.toSatisfy((e) => isCheckViolation(e, 'orders_vault'));
    // Won free: its 30 days to be claimed, after its reservation; the unit reserved for the winner, never waiting for stock.
    await expect(order({ ...free, claim_by: null })).rejects.toSatisfy((e) => isCheckViolation(e, 'orders_vault'));
    await expect(order({ ...free, claim_by: reservedAt })).rejects.toSatisfy((e) => isCheckViolation(e, 'orders_vault'));
    await expect(order({ ...free, reservation: 'AWAITING' })).rejects.toSatisfy((e) => isCheckViolation(e, 'orders_vault'));
    await expect(order({ ...free, reservation: null })).rejects.toSatisfy((e) => isCheckViolation(e, 'orders_vault'));
    const travelsWith = await order({ ...free, vault_id: other });
    await expect(order({ ...free, with_order_id: travelsWith.id })).rejects.toSatisfy((e) => isCheckViolation(e, 'orders_source'));
    const won = await order(free);
    expect(won).toEqual({ id: expect.any(String), status: 'RESERVED', piece: 1, drop_id: null });
    // One open per vault.
    await expect(order(free)).rejects.toSatisfy((e) => isUniqueViolation(e, 'orders_vault_key'));
    // The size changes at the claim to one with stock (the reserved unit swaps): its SKU is not of its identity.
    await db().updateTable('orders').set({ sku_id: size54.id, size_label: '54' }).where('id', '=', won.id).execute();
    await expect(db().updateTable('orders').set({ reservation: 'AWAITING' }).where('id', '=', won.id).execute()).rejects.toSatisfy((e) => isCheckViolation(e, 'orders_vault'));
    // Its vault never changes; a claim_by only on an order won free.
    await expect(sql`UPDATE orders SET vault_id = ${other} WHERE id = ${won.id}`.execute(db())).rejects.toSatisfy(isGuardViolation);
    // Unclaimed at its end: cancelled, the unit back to stock; the vault may then hold another order.
    await db().updateTable('orders').set({ status: 'CANCELLED', cancelled_at: new Date(claimBy.getTime() + HOUR), reservation: null }).where('id', '=', won.id).execute();
    await order({ ...free, reserved_at: new Date(reservedAt.getTime() + HOUR) });
    // Under a right to buy: at its usual price, no claim, as any order paid (it may wait for supplier stock).
    await expect(order({ ...free, vault_id: bought, price_minor: 95000 })).rejects.toSatisfy((e) => isCheckViolation(e, 'orders_vault'));
    const rtb = await order({ ...free, vault_id: bought, price_minor: 95000, claim_by: null, reservation: 'AWAITING' });
    expect(rtb.status).toBe('RESERVED');
    // A claim_by on any other order is refused.
    await expect(order({ channel: 'SALON', shop_request_id: request.id, account_id: account.id, model_id: f.modelId, location_id: location.id, price_minor: 1000, currency: 'EUR', claim_by: claimBy })).rejects.toSatisfy((e) => isCheckViolation(e, 'orders_vault'));
  });

  it('holds a LIVE guarantee to its vault and nothing else named, once per vault, never changed; Client Services grant the three other scopes', async () => {
    const { f, account, vault } = await setup('2026-11-22T10:00:00.000Z');
    const v = await vault('GUARANTEED');
    const other = await vault('GUARANTEED');
    expect([...GUARANTEE_SCOPES]).toEqual([...GRANTED_GUARANTEE_SCOPES, 'LIVE']);
    const g = { account_id: account.id, scope: 'LIVE', pieces: 1, valid_until: new Date('2027-02-20T22:59:59Z') };
    const guarantee = (v: Record<string, unknown>) => db().insertInto('house_guarantees').values(v as never).returning(['id', 'status']).executeTakeFirstOrThrow();
    await expect(guarantee(g)).rejects.toSatisfy((e) => isCheckViolation(e, 'house_guarantees_scope'));
    await expect(guarantee({ ...g, vault_id: v, model_id: f.modelId })).rejects.toSatisfy((e) => isCheckViolation(e, 'house_guarantees_scope'));
    await expect(guarantee({ ...g, scope: 'MODEL', model_id: f.modelId, vault_id: v })).rejects.toSatisfy((e) => isCheckViolation(e, 'house_guarantees_scope'));
    await expect(guarantee({ ...g, scope: 'NEXT', vault_id: v })).rejects.toSatisfy((e) => isCheckViolation(e, 'house_guarantees_scope_check') || isCheckViolation(e, 'house_guarantees_scope'));
    const live = await guarantee({ ...g, vault_id: v });
    expect(live.status).toBe('ACTIVE');
    await expect(guarantee({ ...g, vault_id: v })).rejects.toSatisfy((e) => isUniqueViolation(e, 'house_guarantees_vault_key'));
    await expect(sql`UPDATE house_guarantees SET vault_id = ${other} WHERE id = ${live.id}`.execute(db())).rejects.toSatisfy(isGuardViolation);
    // The staff's scopes are unchanged.
    await guarantee({ ...g, scope: 'MODEL', model_id: f.modelId });
  });

  it('holds the vault\'s free add-on: a unit of source VAULT, its vault, at price 0, no one named; one unit per vault, a removed one aside; its vault never changed', async () => {
    const { f, account, location, size52, addon, addonSku, vault } = await setup('2026-11-23T10:00:00.000Z');
    const v = await vault('ADDON', { offer_until: new Date('2026-12-21T10:00:00.000Z') });
    const other = await vault('ADDON', { offer_until: new Date('2026-12-21T10:00:00.000Z') });
    const request = await db().insertInto('shop_requests').values({ account_id: account.id, model_id: f.modelId, status: 'CLOSED', created_at: new Date(Date.now() - 60_000), handled_at: new Date(), outcome: 'ACCEPTED' }).returning('id').executeTakeFirstOrThrow();
    const order = await db()
      .insertInto('orders')
      .values({ channel: 'SALON', shop_request_id: request.id, account_id: account.id, model_id: f.modelId, location_id: location.id, sku_id: size52.id, reservation: 'STOCK', price_minor: 90000, currency: 'EUR' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const unit = { order_id: order.id, addon_id: addon.id, sku_id: addonSku.id, location_id: location.id, price_minor: 0, currency: 'EUR', added_by_type: 'VAULT', vault_id: v };
    const add = (u: Record<string, unknown>) => db().insertInto('order_addon_items').values(u as never).returning(['id', 'status', 'price_minor']).executeTakeFirstOrThrow();
    await expect(add({ ...unit, vault_id: null })).rejects.toSatisfy((e) => isCheckViolation(e, 'order_addon_items_vault'));
    await expect(add({ ...unit, price_minor: 1500 })).rejects.toSatisfy((e) => isCheckViolation(e, 'order_addon_items_vault'));
    await expect(add({ ...unit, added_by: account.id })).rejects.toSatisfy((e) => isCheckViolation(e, 'order_addon_items_added_by'));
    await expect(add({ ...unit, added_by_type: 'PURCHASE' })).rejects.toSatisfy((e) => isCheckViolation(e, 'order_addon_items_vault'));
    await expect(add({ ...unit, added_by_type: 'LOTTERY' })).rejects.toSatisfy((e) => isCheckViolation(e, 'order_addon_items_added_by_type_check') || isCheckViolation(e, 'order_addon_items_vault'));
    const free = await add(unit);
    expect(free).toEqual({ id: expect.any(String), status: 'HELD', price_minor: 0 });
    await expect(add(unit)).rejects.toSatisfy((e) => isUniqueViolation(e, 'order_addon_items_vault_key'));
    await expect(sql`UPDATE order_addon_items SET vault_id = ${other} WHERE id = ${free.id}`.execute(db())).rejects.toSatisfy(isGuardViolation);
    // Removed before packing: the vault's add-on may be attached again.
    await db().updateTable('order_addon_items').set({ status: 'REMOVED', removed_at: new Date() }).where('id', '=', free.id).execute();
    await add(unit);
    // A unit at price 0 is not a vault's unless its source says so (Q2's units unchanged).
    await add({ ...unit, added_by_type: 'STAFF', vault_id: null });
  });

  it('holds a credit to give: its vault once, the code\'s HMAC once, 30 days, accepted once with its grant, its identity fixed, never deleted', async () => {
    const { account, friend, vault } = await setup('2026-11-24T10:00:00.000Z');
    const v = await vault('CREDIT_TO_GIVE');
    const w = await vault('CREDIT_TO_GIVE');
    const createdAt = new Date('2026-11-24T10:00:00.000Z');
    const gift = { vault_id: v, code_hash: new Uint8Array(randomBytes(VAULT_GIFT_CODE_HASH_BYTES)), amount_minor: 3000, currency: 'EUR', created_at: createdAt, expires_at: new Date(createdAt.getTime() + VAULT_GIFT_DAYS * DAY) };
    const give = (g: Record<string, unknown>) => db().insertInto('vault_gifts').values(g as never).returning(['id', 'accepted_by', 'accepted_at', 'grant_id']).executeTakeFirstOrThrow();
    await expect(give({ ...gift, code_hash: new Uint8Array(16) })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_gifts_code_hash_check'));
    await expect(give({ ...gift, amount_minor: 0 })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_gifts_amount_minor_check'));
    await expect(give({ ...gift, currency: 'eur' })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_gifts_currency_check'));
    await expect(give({ ...gift, expires_at: new Date(createdAt.getTime() + 29 * DAY) })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_gifts_expiry'));
    const accepted = { accepted_by: friend.id, accepted_at: new Date(createdAt.getTime() + DAY) };
    await expect(give({ ...gift, ...accepted })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_gifts_accepted'));
    const made = await give(gift);
    expect(made).toEqual({ id: expect.any(String), accepted_by: null, accepted_at: null, grant_id: null });
    await expect(give({ ...gift, code_hash: new Uint8Array(randomBytes(32)) })).rejects.toSatisfy((e) => isUniqueViolation(e, 'vault_gifts_vault_key'));
    await expect(give({ ...gift, vault_id: w })).rejects.toSatisfy((e) => isUniqueViolation(e, 'vault_gifts_code_hash_key'));
    // Its identity never changes.
    await expect(db().updateTable('vault_gifts').set({ amount_minor: 5000 } as never).where('id', '=', made.id).execute()).rejects.toSatisfy(isGuardViolation);
    await expect(sql`UPDATE vault_gifts SET code_hash = ${new Uint8Array(randomBytes(32))} WHERE id = ${made.id}`.execute(db())).rejects.toSatisfy(isGuardViolation);
    // Accepted once: the friend, the time and their VAULT credit, all three.
    const grant = await db()
      .insertInto('tier_grants')
      .values({ account_id: friend.id, kind: 'VAULT', vault_id: v, usable_while_no_piece: true, amount_minor: 3000, currency: 'EUR', expires_at: new Date(createdAt.getTime() + 31 * DAY) })
      .returning('id')
      .executeTakeFirstOrThrow();
    const accept = (a: Record<string, unknown>) => db().updateTable('vault_gifts').set(a as never).where('id', '=', made.id).execute();
    await expect(accept(accepted)).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_gifts_accepted'));
    await expect(accept({ ...accepted, grant_id: grant.id, accepted_at: new Date(createdAt.getTime() - HOUR) })).rejects.toSatisfy((e) => isCheckViolation(e, 'vault_gifts_accepted'));
    await accept({ ...accepted, grant_id: grant.id });
    await expect(accept({ accepted_by: account.id })).rejects.toSatisfy(isGuardViolation);
    await expect(accept({ accepted_by: null, accepted_at: null, grant_id: null })).rejects.toSatisfy(isGuardViolation);
    // The vault links its gift once; the gift is never deleted.
    await db().updateTable('vaults').set({ gift_id: made.id }).where('id', '=', v).execute();
    const second = await give({ ...gift, vault_id: w, code_hash: new Uint8Array(randomBytes(32)) });
    await expect(db().updateTable('vaults').set({ gift_id: second.id }).where('id', '=', v).execute()).rejects.toSatisfy(isGuardViolation);
    await expect(db().deleteFrom('vault_gifts').where('id', '=', made.id).execute()).rejects.toSatisfy(isGuardViolation);
  });

  it('holds a vault\'s gift and offer: none before the opening; an offer on an ADDON or PRODUCT reward, after the opening, its end written with the outcome, used within it and once', async () => {
    const { vault, openedAt } = await setup('2026-11-25T10:00:00.000Z');
    const closed = await vault();
    const set = (id: string, v: Record<string, unknown>) => db().updateTable('vaults').set(v as never).where('id', '=', id).execute();
    await expect(set(closed, { offer_until: new Date(openedAt.getTime() + DAY) })).rejects.toSatisfy((e) => isCheckViolation(e, 'vaults_outcome') || isCheckViolation(e, 'vaults_offer'));
    await expect(set(closed, { offer_used_at: openedAt })).rejects.toSatisfy((e) => isCheckViolation(e, 'vaults_outcome') || isCheckViolation(e, 'vaults_offer'));
    // On an ADDON or PRODUCT reward only, ending after the opening.
    await expect(vault('CREDIT', { offer_until: new Date(openedAt.getTime() + DAY) })).rejects.toSatisfy((e) => isCheckViolation(e, 'vaults_offer'));
    await expect(vault('PRODUCT', { offer_until: openedAt })).rejects.toSatisfy((e) => isCheckViolation(e, 'vaults_offer'));
    const until = new Date(openedAt.getTime() + 24 * HOUR);
    const rtb = await vault('PRODUCT', { offer_until: until });
    // Its end is the outcome's: written once.
    await expect(set(rtb, { offer_until: new Date(until.getTime() + HOUR) })).rejects.toSatisfy(isGuardViolation);
    // Used within it, once.
    await expect(set(rtb, { offer_used_at: new Date(until.getTime() + 1) })).rejects.toSatisfy((e) => isCheckViolation(e, 'vaults_offer'));
    await expect(set(rtb, { offer_used_at: new Date(openedAt.getTime() - 1) })).rejects.toSatisfy((e) => isCheckViolation(e, 'vaults_offer'));
    await set(rtb, { offer_used_at: new Date(openedAt.getTime() + HOUR) });
    await expect(set(rtb, { offer_used_at: new Date(openedAt.getTime() + 2 * HOUR) })).rejects.toSatisfy(isGuardViolation);
    await expect(set(rtb, { offer_used_at: null })).rejects.toSatisfy(isGuardViolation);
    // A free add-on's 30 days.
    await vault('ADDON', { offer_until: new Date(openedAt.getTime() + 30 * DAY) });
    // Not used: no use.
    const unused = await vault('ADDON', { offer_until: new Date(openedAt.getTime() + 30 * DAY) });
    expect((await db().selectFrom('vaults').select(['offer_used_at']).where('id', '=', unused).executeTakeFirstOrThrow()).offer_used_at).toBeNull();
  });

  it('refuses to roll back while a vault credit, a VAULT order, a LIVE guarantee, a VAULT unit, a credit to give or a vault offer exists, naming the counts', async () => {
    const n = async (query: string) => Number((await sql<{ n: string | number }>`${sql.raw(`SELECT count(*) AS n FROM ${query}`)}`.execute(db())).rows[0]!.n);
    const counts = [
      await n(`tier_grants WHERE kind = 'VAULT'`),
      await n(`orders WHERE channel = 'VAULT'`),
      await n(`house_guarantees WHERE scope = 'LIVE'`),
      await n(`order_addon_items WHERE added_by_type = 'VAULT'`),
      await n('vault_gifts'),
      await n('vaults WHERE offer_until IS NOT NULL'),
    ];
    expect(counts.every((c) => c > 0)).toBe(true);
    await expect(downTo0061(db())).rejects.toThrow(
      `migration 0062_vault_rewards cannot be rolled back: ${counts[0]} vault credits, ${counts[1]} vault orders, ${counts[2]} LIVE guarantees, ${counts[3]} vault add-on units, ${counts[4]} credits to give and ${counts[5]} vault offers exist`,
    );
    expect((await createMigrator(db()).getMigrations()).filter((m) => m.executedAt).map((m) => m.name).at(-1)).toBe(LATER);
  });
}

describe('migration 0062_vault_rewards (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  }, 120_000);
  afterAll(async () => {
    await t?.close();
  });
  cases({
    db: () => t.db,
    schemaAt0061: async () => {
      const fresh = await createTestDb({ migrated: false });
      try {
        const rs = await createMigrator(fresh.db).migrateTo(BEFORE);
        if (rs.error) throw rs.error;
        return { schema: await snapshotOf(fresh.db), guard: await guardOf(fresh.db) };
      } finally {
        await fresh.close();
      }
    },
  });
});

describe.skipIf(!pgUrl)('migration 0062_vault_rewards (PostgreSQL)', () => {
  let admin: Db;
  let db: Db;
  const dbName = `orbes_t_${randomBytes(6).toString('hex')}`;
  beforeAll(async () => {
    admin = createDb(pgUrl!);
    await sql`CREATE DATABASE ${sql.id(dbName)}`.execute(admin);
    const u = new URL(pgUrl!);
    u.pathname = `/${dbName}`;
    db = createDb(u.toString(), { poolMax: 4 });
    await migrateToLatest(db);
  }, 120_000);
  afterAll(async () => {
    if (db) await closeDb(db).catch(() => undefined);
    if (admin) {
      await sql`DROP DATABASE IF EXISTS ${sql.id(dbName)} WITH (FORCE)`.execute(admin);
      await closeDb(admin);
    }
  });
  cases({ db: () => db, schemaAt0061: async () => null });
});
