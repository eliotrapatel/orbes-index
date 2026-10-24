/**
 * Fixtures of the LIVE RELEASES' tests (services/live.ts): accounts, the pieces they hold (their tier in the club),
 * models and collections, and a LIVE release made as the console makes one: a drop with its sealed seed
 * (DropService.create), then its LIVE settings, sizes, its pick of catalogue add-ons, per-tier windows and access rule,
 * its after-room as the
 * console writes one (LiveConsoleService), published; the stock locations of the first boot, where a confirmed entry's
 * orders go. Macro scope K44 T1 (M3.16): a set of sized models and its LIVE RELEASE, made by the console with its sizes
 * per piece.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { packIdentity } from '../../src/core/identity.js';
import { testConfig, type AppConfig } from '../../src/server/config.js';
import type { Db } from '../../src/server/db/connection.js';
import { ADDON_TEXT_MAX, jsonText, type HouseCurrency } from '../../src/server/db/schema.js';
import { AddonService } from '../../src/server/services/addons.js';
import { AuditService } from '../../src/server/services/audit.js';
import { CLUB_TIER_THRESHOLDS } from '../../src/server/services/club.js';
import { deriveDropSeedKey, DropService } from '../../src/server/services/drops.js';
import { deriveLiveTurnKey, LiveService } from '../../src/server/services/live.js';
import { LiveConsoleService, type AfterRoomInput } from '../../src/server/services/live-console.js';
import { SetService } from '../../src/server/services/sets.js';
import { ensureStockSetup } from '../../src/server/services/stock.js';
import { createManualClock, SYSTEM_ACTOR, type Actor, type ManualClock } from '../../src/server/types.js';
import { giveSizes, poolDraw } from './draws.js';

export interface LiveFixture {
  db: Db;
  clock: ManualClock;
  audit: AuditService;
  drops: DropService;
  live: LiveService;
  /** The console's service: an after-room is written as the console writes it. */
  liveConsole: LiveConsoleService;
  seedKey: Uint8Array;
  turnKey: Uint8Array;
  /** A console user (ADMIN). */
  admin: Actor & { id: string };
  /** The model of the releases by default (MONOLITHE). */
  modelId: string;
}

const CATEGORY = 1;

/** Services on `db` with one manual clock, the keys derived as the context derives them. */
export async function liveFixture(db: Db, start: string): Promise<LiveFixture> {
  const clock = createManualClock(start);
  const config = testConfig();
  const seedKey = deriveDropSeedKey(config);
  const turnKey = deriveLiveTurnKey(config);
  const audit = new AuditService({ db, clock: clock.now });
  const drops = new DropService({ db, audit, seedKey, clock: clock.now });
  const live = new LiveService({ db, audit, seedKey, turnKey, clock: clock.now });
  const liveConsole = new LiveConsoleService({ db, audit, seedKey, publicOrigin: config.publicOrigin, clock: clock.now });
  await db.insertInto('categories').values({ id: CATEGORY, code: 'J', name: 'Jewelry' }).onConflict((oc) => oc.doNothing()).execute();
  const email = `live-admin-${randomUUID()}@orbes.test`;
  const adminId = (await db.insertInto('admin_users').values({ email, email_normalized: email, password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow()).id;
  const modelId = await createModel(db, 'MONOLITHE');
  // The locations of the first boot (createContext's OrderService.prepare): a confirmed entry's orders go there.
  await ensureStockSetup(db, audit, SYSTEM_ACTOR, clock.now());
  return { db, clock, audit, drops, live, liveConsole, seedKey, turnKey, admin: { type: 'admin', id: adminId }, modelId };
}

/**
 * The same fixture on an application's context (test/api: the routes and the services share its database, clock and
 * keys), its console user and model created as `liveFixture` creates them.
 */
export async function liveFixtureOn(
  ctx: { db: Db; config: AppConfig; audit: AuditService; services: { drops: DropService; live: LiveService; liveConsole: LiveConsoleService } },
  clock: ManualClock,
): Promise<LiveFixture> {
  const db = ctx.db;
  await db.insertInto('categories').values({ id: CATEGORY, code: 'J', name: 'Jewelry' }).onConflict((oc) => oc.doNothing()).execute();
  const email = `live-admin-${randomUUID()}@orbes.test`;
  const adminId = (await db.insertInto('admin_users').values({ email, email_normalized: email, password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow()).id;
  const modelId = await createModel(db, 'MONOLITHE');
  return {
    db,
    clock,
    audit: ctx.audit,
    drops: ctx.services.drops,
    live: ctx.services.live,
    liveConsole: ctx.services.liveConsole,
    seedKey: deriveDropSeedKey(ctx.config),
    turnKey: deriveLiveTurnKey(ctx.config),
    admin: { type: 'admin', id: adminId },
    modelId,
  };
}

export async function createModel(db: Db, name: string, collectionId: string | null = null, type = 'RING'): Promise<string> {
  return (
    await db
      .insertInto('models')
      .values({ category_id: CATEGORY, collection_id: collectionId, name, type, sku_prefix: `${name.slice(0, 3)}-${randomUUID().slice(0, 8)}` })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
}

export async function createCollection(db: Db, name: string): Promise<string> {
  return (await db.insertInto('collections').values({ name }).returning('id').executeTakeFirstOrThrow()).id;
}

/** An ACTIVE account. */
export async function createAccount(db: Db): Promise<{ id: string; email: string; actor: Actor }> {
  const email = `live-${randomUUID()}@example.com`;
  const id = (await db.insertInto('accounts').values({ email, email_normalized: email, password_hash: 'unused' }).returning('id').executeTakeFirstOrThrow()).id;
  return { id, email, actor: { type: 'account', id } };
}

/**
 * `n` pieces held now by the account (open ownerships), of `modelId`; a piece's own collection when given, its size
 * (`products.variant`), the start of its ownership (1 January 2025 by default) and the year of its serial (2026 by
 * default; another year's serials leave those of 2026 as they are).
 */
export async function holdPieces(
  db: Db,
  accountId: string,
  n: number,
  modelId: string,
  opts: { collectionId?: string | null; variant?: string | null; startedAt?: Date; year?: number } = {},
): Promise<string[]> {
  const ids: string[] = [];
  const year = opts.year ?? 2026;
  for (let i = 0; i < n; i++) {
    const top = await db.selectFrom('products').select((eb) => eb.fn.max('serial').as('s')).where('category_id', '=', CATEGORY).where('year', '=', year).executeTakeFirstOrThrow();
    const serial = Number(top.s ?? 0) + 1;
    const product = await db
      .insertInto('products')
      .values({
        product_id: `O${String(year % 100).padStart(2, '0')}-J-${String(serial).padStart(5, '0')}`,
        packed_identity: packIdentity({ year, categoryIndex: CATEGORY, serial }),
        year,
        category_id: CATEGORY,
        serial,
        sku: `LIVE-${serial}`,
        model_id: modelId,
        collection_id: opts.collectionId ?? null,
        variant: opts.variant ?? null,
        material: '925 STERLING SILVER',
        status: 'OWNED',
        ownership_state: 'OWNED',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db.insertInto('ownership').values({ product_id: product.id, account_id: accountId, acquired_via: 'ADMIN', started_at: opts.startedAt ?? new Date('2025-01-01T00:00:00Z') }).execute();
    ids.push(product.id);
  }
  return ids;
}

/** An account holding the pieces its tier starts from (CLUB_TIER_THRESHOLDS): tier 0 (none), 1 TITANE (1), 2 PLATINE (5), 3 PALLADIUM (10). */
export async function accountOfTier(f: Pick<LiveFixture, 'db' | 'modelId'>, tier: 0 | 1 | 2 | 3) {
  const a = await createAccount(f.db);
  const pieces = tier === 0 ? 0 : CLUB_TIER_THRESHOLDS[tier - 1]!;
  if (pieces) await holdPieces(f.db, a.id, pieces, f.modelId);
  return a;
}

/**
 * ONE QUEUE (lot Q1, D1): every LIVE release has a pace. The fixtures' default gives every entry placed at T0 its turn
 * at T0 (the most a batch gives, every minute) with no hold, so a release reads as the room did before ONE QUEUE until a
 * piece returns: that waits for the next batch, on the minute from T0.
 */
export const LIVE_TEST_PACE = Object.freeze({ batch: 5000, minutes: 1 });

export interface LiveReleaseOptions {
  opensAt: Date;
  closesAt?: Date;
  sizes?: { label: string; stock: number }[];
  /**
   * Lot Q2, step Q2.3 (D3): the catalogue add-ons its purchase offers, in order (`drop_addons`); none by default. A
   * fixture picks explicitly, never the console's default of a new release (N7): a release offers exactly what it is given.
   */
  addonIds?: string[];
  minTier?: number;
  tierPriority?: boolean;
  roomOpensMinutes?: number;
  /** X people per batch every Y minutes; LIVE_TEST_PACE by default (null: none, only for a release that has ended). */
  pace?: { batch: number; minutes: number } | null;
  /** The hold after the opening, in minutes (0 by default). */
  holdMinutes?: number;
  turnSeconds?: number;
  payMinutes?: number;
  perAccount?: number;
  priceMinor?: number;
  quantityLine?: string;
  /** Per tier: turn seconds and pay minutes (null: the release's). */
  windows?: { tier: number; turnSeconds?: number | null; payMinutes?: number | null }[];
  accessModels?: string[];
  accessCollectionId?: string | null;
  /** Plan LIVE RELEASE+: the releases taken part in, a segment, how the rules combine; the surprise in every box. */
  minParticipations?: number | null;
  accessSegmentId?: string | null;
  accessCombine?: 'AND' | 'OR' | null;
  surprise?: string | null;
  announceAt?: Date | null;
  /** Published now unless false. */
  published?: boolean;
  modelId?: string;
  /** Its after-room, written by the console before the publication (the room still ahead). */
  afterRoom?: AfterRoomInput;
}

export interface LiveRelease {
  id: string;
  sizes: { id: string; label: string; stock: number }[];
  /** Its after-room, when it has one. */
  afterRoom: { id: string; sizes: { id: string; label: string; stock: number }[] } | null;
}

/** A LIVE release, published at the fixture's clock unless asked otherwise. */
export async function createLiveRelease(f: LiveFixture, o: LiveReleaseOptions): Promise<LiveRelease> {
  const sizes = o.sizes ?? [{ label: '52', stock: 2 }];
  const quantity = Math.max(1, sizes.reduce((n, s) => n + s.stock, 0));
  const closesAt = o.closesAt ?? new Date(o.opensAt.getTime() + 3_600_000);
  const created = await poolDraw(f.drops, f.db, { modelId: o.modelId ?? f.modelId, title: 'LIVE', quantity, opensAt: o.opensAt, closesAt, earlyAccessHours: 0 }, f.admin, { publish: false });
  const id = created.id;
  await f.db
    .updateTable('drops')
    .set({
      mode: 'LIVE',
      // A LIVE RELEASE has no early access, nor PLATINE's window of a draw (drops_live_platine, migration 0026).
      early_access_platine_hours: null,
      live_min_tier: o.minTier ?? 0,
      tier_priority: o.tierPriority ?? true,
      room_opens_minutes: o.roomOpensMinutes ?? 5,
      pace_batch: o.pace === null ? null : (o.pace ?? LIVE_TEST_PACE).batch,
      pace_minutes: o.pace === null ? null : (o.pace ?? LIVE_TEST_PACE).minutes,
      pace_hold_minutes: o.holdMinutes ?? 0,
      turn_seconds: o.turnSeconds ?? 30,
      pay_minutes: o.payMinutes ?? 5,
      per_account: o.perAccount ?? 1,
      price_minor: o.priceMinor ?? 505_000,
      currency: 'EUR',
      quantity_line: o.quantityLine ?? `${quantity} PIECES`,
      announce_at: o.announceAt ?? null,
      access_collection_id: o.accessCollectionId ?? null,
      min_participations: o.minParticipations ?? null,
      access_segment_id: o.accessSegmentId ?? null,
      access_combine: o.accessCombine ?? null,
      surprise_enabled: o.surprise ? true : null,
      surprise_text: o.surprise ?? null,
    })
    .where('id', '=', id)
    .execute();
  const sizeRows = await f.db
    .insertInto('drop_sizes')
    .values(sizes.map((s, i) => ({ drop_id: id, label: s.label, position: i + 1, stock: s.stock })))
    .returning(['id', 'label', 'stock', 'position'])
    .execute();
  if (o.windows?.length) {
    await f.db
      .insertInto('live_tier_windows')
      .values(o.windows.map((w) => ({ drop_id: id, tier: w.tier, turn_seconds: w.turnSeconds ?? null, pay_minutes: w.payMinutes ?? null })))
      .execute();
  }
  if (o.accessModels?.length) await f.db.insertInto('live_access_models').values(o.accessModels.map((m) => ({ drop_id: id, model_id: m }))).execute();
  // Q2.3: its pick exactly as given (the draw it was created as took the draws' default: replaced), its after-room's too.
  await pickAddons(f.db, id, o.addonIds ?? []);
  if (o.afterRoom) await f.liveConsole.update(id, { afterRoom: { addonIds: [], ...o.afterRoom } }, f.admin);
  if (o.published !== false) await f.db.updateTable('drops').set({ published_at: f.clock.now() }).where('id', '=', id).execute();
  const child = o.afterRoom ? await f.db.selectFrom('drops').select('id').where('parent_drop_id', '=', id).executeTakeFirstOrThrow() : null;
  return {
    id,
    sizes: sizeRows.sort((a, b) => a.position - b.position).map((s) => ({ id: s.id, label: s.label, stock: s.stock })),
    afterRoom: child ? { id: child.id, ...(await offerOf(f.db, child.id)) } : null,
  };
}

/**
 * A release's pick of catalogue add-ons written as given (lot Q2, step Q2.3: `drop_addons`, in order), whatever its state:
 * what migration 0060 writes for a release under way, or a fixture's release offering exactly these.
 */
export async function pickAddons(db: Db, dropId: string, addonIds: readonly string[]): Promise<void> {
  await db.deleteFrom('drop_addons').where('drop_id', '=', dropId).execute();
  if (addonIds.length > 0) await db.insertInto('drop_addons').values(addonIds.map((addon_id, i) => ({ drop_id: dropId, addon_id, position: i + 1 }))).execute();
}

/** A release's sizes, in order. */
export async function offerOf(db: Db, dropId: string) {
  return { sizes: await db.selectFrom('drop_sizes').select(['id', 'label', 'stock']).where('drop_id', '=', dropId).orderBy('position').execute() };
}

/**
 * A catalogue service a LIVE release may pick (lot Q2, step Q2.4, D2: what a release add-on became, as 0060 converts
 * one): its name, line and EUR price, its LIVE switch only, the engraving with its most characters when asked. One per
 * name (addon_items_name_key): an add-on of that name already there is reinstated and given this line, price and flag.
 * Returns its id.
 */
export async function liveAddon(
  f: Pick<LiveFixture, 'db' | 'audit' | 'clock' | 'admin'>,
  o: { name: string; line?: string | null; priceMinor: number; engraving?: boolean; textMax?: number },
): Promise<string> {
  const addons = new AddonService({ db: f.db, audit: f.audit, clock: f.clock.now });
  const found = await f.db.selectFrom('addon_items').select('id').where(sql<boolean>`lower(name) = lower(${o.name})`).executeTakeFirst();
  if (!found) {
    const code = `ADD-${o.name.replace(/[^A-Z0-9]+/gi, '-').toUpperCase().slice(0, 24)}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const made = await addons.create(
      {
        kind: 'SERVICE',
        name: o.name,
        line: o.line ?? null,
        skuCode: code,
        prices: { EUR: o.priceMinor },
        offeredAt: { live: true, draw: false, salon: false, orders: false },
        ...(o.engraving ? { engraving: true, ...(o.textMax !== undefined ? { textMax: o.textMax } : {}) } : {}),
      },
      f.admin,
    );
    return made.id;
  }
  await f.db
    .updateTable('addon_items')
    .set({ active: true, line: o.line ?? null, engraving: o.engraving === true, text_max: o.engraving ? (o.textMax ?? ADDON_TEXT_MAX.max) : ADDON_TEXT_MAX.max, offer_live: true })
    .where('id', '=', found.id)
    .execute();
  await f.db
    .insertInto('addon_item_prices')
    .values({ addon_id: found.id, currency: 'EUR', price_minor: o.priceMinor })
    .onConflict((oc) => oc.columns(['addon_id', 'currency']).doUpdateSet({ price_minor: o.priceMinor }))
    .execute();
  return found.id;
}

/**
 * The engraving YOUR ORDERS offers (lot Q2, step Q2.5, N4: what Orders → Settings, Engraving became, as 0060 converts
 * it): the active engraving add-on (else the add-on named ENGRAVING, reinstated as the engraving, else a new ENGRAVING
 * service with no other switch) given these prices (null: none in that currency; the others left) and its YOUR ORDERS
 * switch on while it has a price; its most characters when asked. Through the console's service, audited. Returns its id.
 */
export async function ordersEngravingPrices(
  f: Pick<LiveFixture, 'db' | 'audit' | 'clock' | 'admin'>,
  prices: Partial<Record<HouseCurrency, number | null>>,
  o: { textMax?: number } = {},
): Promise<string> {
  const addons = new AddonService({ db: f.db, audit: f.audit, clock: f.clock.now });
  let id = (await f.db.selectFrom('addon_items').select('id').where('engraving', '=', true).where('active', '=', true).executeTakeFirst())?.id;
  if (!id) {
    const named = await f.db.selectFrom('addon_items').select('id').where(sql<boolean>`lower(name) = 'engraving'`).executeTakeFirst();
    if (named) {
      await f.db.updateTable('addon_items').set({ active: true, engraving: true }).where('id', '=', named.id).execute();
      id = named.id;
    }
  }
  if (!id) {
    const made = await addons.create(
      {
        kind: 'SERVICE',
        name: 'ENGRAVING',
        line: null,
        skuCode: `ADD-ENGRAVING-${randomUUID().slice(0, 8).toUpperCase()}`,
        prices: {},
        offeredAt: { live: false, draw: false, salon: false, orders: true },
        engraving: true,
      },
      f.admin,
    );
    id = made.id;
  }
  if (Object.keys(prices).length > 0) await addons.setPrices(id, prices, f.admin);
  const priced = (await f.db.selectFrom('addon_item_prices').select('currency').where('addon_id', '=', id).execute()).length > 0;
  const now = await f.db.selectFrom('addon_items').select(['offer_orders', 'text_max']).where('id', '=', id).executeTakeFirstOrThrow();
  const change = { ...(now.offer_orders !== priced ? { offeredAt: { orders: priced } } : {}), ...(o.textMax !== undefined && o.textMax !== now.text_max ? { textMax: o.textMax } : {}) };
  if (Object.keys(change).length > 0) await addons.update(id, change, f.admin);
  return id;
}

/**
 * A LIVE sale of before lot Q2 (N15): each order of the account's entry in the release given its release add-ons as that
 * PAY wrote them (every piece's order; a set's, each set's first piece's), the snapshot a test of an order's history reads.
 */
export async function legacyLiveAddons(db: Db, dropId: string, accountId: string, addons: readonly { label: string; priceMinor: number }[]): Promise<void> {
  const rows = await db
    .selectFrom('orders as o')
    .innerJoin('live_entries as e', 'e.id', 'o.live_entry_id')
    .select(['o.id', 'o.set_piece'])
    .where('e.drop_id', '=', dropId)
    .where('e.account_id', '=', accountId)
    .execute();
  // One release add-on, one id on every order (live_addons' then).
  const sold = addons.map((a) => ({ id: randomUUID(), ...a }));
  for (const o of rows) if (o.set_piece === null || o.set_piece === 1) await legacyAddons(db, o.id, sold);
}

/**
 * An order of before lot Q2 given its release add-ons as that PAY wrote them (N15: `orders.addons`, history as sold):
 * the snapshot of an order the story closes before its NOW (a past release), each with an id of its own.
 */
export async function legacyAddons(db: Db, orderId: string, addons: readonly { id?: string; label: string; priceMinor: number }[]): Promise<void> {
  await db
    .updateTable('orders')
    .set({ addons: jsonText(addons.map((a) => ({ id: a.id ?? randomUUID(), label: a.label, priceMinor: a.priceMinor }))) })
    .where('id', '=', orderId)
    .execute();
}

/** Every entry of a release, by place then arrival. */
export async function entriesOf(db: Db, dropId: string) {
  return db
    .selectFrom('live_entries')
    .selectAll()
    .where('drop_id', '=', dropId)
    .orderBy((eb) => eb.fn.coalesce('position', eb.val(2_147_483_647)))
    .orderBy('joined_at')
    .orderBy('id')
    .execute();
}

// ── THE SET (macro scope K44 T1, M3.16) ────────────────────────────────────

/** A model of `type` whose sizes `labels` are declared (its size type and kind), each its own SKU. */
export async function sizedModel(db: Db, name: string, labels: readonly string[], type: 'RING' | 'NECKLACE' = 'RING'): Promise<string> {
  const id = await createModel(db, `${name} ${randomUUID().slice(0, 6).toUpperCase()}`, null, type);
  await giveSizes(db, id, labels, type);
  return id;
}

/** A set of `modelIds` (2 to 4 sized models), offered, created as the console creates one. */
export async function createSet(f: Pick<LiveFixture, 'db' | 'audit' | 'clock' | 'admin'>, modelIds: readonly string[], name = 'THE PAIR'): Promise<string> {
  const sets = new SetService({ db: f.db, audit: f.audit, clock: f.clock.now });
  const tag = randomUUID().slice(0, 6).toUpperCase();
  return (await sets.create({ name: `${name} ${tag}`, code: `SET-${tag}`, modelIds: [...modelIds] }, f.admin)).id;
}

export interface SetLiveOptions {
  setId: string;
  opensAt: Date;
  closesAt?: Date;
  /** Its sizes per piece (each one of its piece's model's sizes). */
  sizes: { piece: number; label: string; stock: number }[];
  perAccount?: number;
  /** LIVE_TEST_PACE by default. */
  pace?: { batch: number; minutes: number };
  holdMinutes?: number;
  priceMinor?: number;
  turnSeconds?: number;
  payMinutes?: number;
  title?: string;
  /** Lot Q2, step Q2.4: its pick of catalogue add-ons, in order; none by default (never the console's default, N7). */
  addonIds?: string[];
  /** Published now unless false (the console's PUBLISH: the clock must be before its room). */
  published?: boolean;
}

export interface SetLiveRelease {
  id: string;
  /** Its sizes in order, each with its piece. */
  sizes: { id: string; label: string; stock: number; piece: number }[];
}

/** A set's LIVE RELEASE made and published by the console (LiveConsoleService), its room 5 minutes before T0. */
export async function createSetLiveRelease(f: LiveFixture, o: SetLiveOptions): Promise<SetLiveRelease> {
  const created = await f.liveConsole.create(
    {
      setId: o.setId,
      title: o.title ?? 'THE PAIR — LIVE',
      opensAt: o.opensAt,
      closesAt: o.closesAt ?? new Date(o.opensAt.getTime() + 3_600_000),
      roomOpensMinutes: 5,
      sizes: o.sizes,
      priceMinor: o.priceMinor ?? 200_000,
      currency: 'EUR',
      ...(o.perAccount !== undefined ? { perAccount: o.perAccount } : {}),
      pace: o.pace ?? LIVE_TEST_PACE,
      holdMinutes: o.holdMinutes ?? 0,
      addonIds: o.addonIds ?? [],
      ...(o.turnSeconds !== undefined ? { turnSeconds: o.turnSeconds } : {}),
      ...(o.payMinutes !== undefined ? { payMinutes: o.payMinutes } : {}),
    },
    f.admin,
  );
  if (o.published !== false) await f.liveConsole.publish(created.id, {}, f.admin);
  return { id: created.id, sizes: created.sizes.map((s) => ({ id: s.id, label: s.label, stock: s.stock, piece: s.piece! })) };
}

/** The size `label` of piece `piece` of a set's release. */
export const pieceSize = (r: SetLiveRelease, piece: number, label: string): string => r.sizes.find((s) => s.piece === piece && s.label === label)!.id;
