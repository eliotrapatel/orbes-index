/**
 * Fixtures of the LIVE RELEASES' tests (services/live.ts): accounts, the pieces they hold (their tier in the club),
 * models and collections, and a LIVE release made as the console makes one: a drop with its sealed seed
 * (DropService.create), then its LIVE settings, sizes, add-ons, per-tier windows and access rule, its after-room as the
 * console writes one (LiveConsoleService), published; the stock locations of the first boot, where a confirmed entry's
 * orders go.
 */
import { randomUUID } from 'node:crypto';
import { packIdentity } from '../../src/core/identity.js';
import { testConfig, type AppConfig } from '../../src/server/config.js';
import type { Db } from '../../src/server/db/connection.js';
import { AuditService } from '../../src/server/services/audit.js';
import { deriveDropSeedKey, DropService } from '../../src/server/services/drops.js';
import { deriveLiveTurnKey, LiveService } from '../../src/server/services/live.js';
import { LiveConsoleService, type AfterRoomInput } from '../../src/server/services/live-console.js';
import { ensureStockSetup } from '../../src/server/services/stock.js';
import { createManualClock, SYSTEM_ACTOR, type Actor, type ManualClock } from '../../src/server/types.js';

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
 * (`products.variant`) and the start of its ownership (1 January 2025 by default).
 */
export async function holdPieces(
  db: Db,
  accountId: string,
  n: number,
  modelId: string,
  opts: { collectionId?: string | null; variant?: string | null; startedAt?: Date } = {},
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const top = await db.selectFrom('products').select((eb) => eb.fn.max('serial').as('s')).where('category_id', '=', CATEGORY).where('year', '=', 2026).executeTakeFirstOrThrow();
    const serial = Number(top.s ?? 0) + 1;
    const product = await db
      .insertInto('products')
      .values({
        product_id: `O26-J-${String(serial).padStart(5, '0')}`,
        packed_identity: packIdentity({ year: 2026, categoryIndex: CATEGORY, serial }),
        year: 2026,
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

/** An account holding `pieces` pieces: tier 0 (none), 1 TITANE (1), 2 PLATINE (3), 3 PALLADIUM (5). */
export async function accountOfTier(f: Pick<LiveFixture, 'db' | 'modelId'>, tier: 0 | 1 | 2 | 3) {
  const a = await createAccount(f.db);
  const pieces = [0, 1, 3, 5][tier]!;
  if (pieces) await holdPieces(f.db, a.id, pieces, f.modelId);
  return a;
}

export interface LiveReleaseOptions {
  opensAt: Date;
  closesAt?: Date;
  sizes?: { label: string; stock: number }[];
  addons?: { label: string; line?: string | null; priceMinor: number }[];
  minTier?: number;
  tierPriority?: boolean;
  roomOpensMinutes?: number;
  turnSeconds?: number;
  payMinutes?: number;
  perAccount?: number;
  priceMinor?: number;
  quantityLine?: string;
  /** Per tier: turn seconds and pay minutes (null: the release's). */
  windows?: { tier: number; turnSeconds?: number | null; payMinutes?: number | null }[];
  accessModels?: string[];
  accessCollectionId?: string | null;
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
  addons: { id: string; label: string; priceMinor: number }[];
  /** Its after-room, when it has one. */
  afterRoom: { id: string; sizes: { id: string; label: string; stock: number }[]; addons: { id: string; label: string; priceMinor: number }[] } | null;
}

/** A LIVE release, published at the fixture's clock unless asked otherwise. */
export async function createLiveRelease(f: LiveFixture, o: LiveReleaseOptions): Promise<LiveRelease> {
  const sizes = o.sizes ?? [{ label: '52', stock: 2 }];
  const quantity = Math.max(1, sizes.reduce((n, s) => n + s.stock, 0));
  const closesAt = o.closesAt ?? new Date(o.opensAt.getTime() + 3_600_000);
  const created = await f.drops.create({ modelId: o.modelId ?? f.modelId, title: 'LIVE', quantity, opensAt: o.opensAt, closesAt, earlyAccessHours: 0 }, f.admin);
  const id = created.id;
  await f.db
    .updateTable('drops')
    .set({
      mode: 'LIVE',
      live_min_tier: o.minTier ?? 0,
      tier_priority: o.tierPriority ?? true,
      room_opens_minutes: o.roomOpensMinutes ?? 5,
      turn_seconds: o.turnSeconds ?? 30,
      pay_minutes: o.payMinutes ?? 5,
      per_account: o.perAccount ?? 1,
      price_minor: o.priceMinor ?? 505_000,
      currency: 'EUR',
      quantity_line: o.quantityLine ?? `${quantity} PIECES`,
      announce_at: o.announceAt ?? null,
      access_collection_id: o.accessCollectionId ?? null,
    })
    .where('id', '=', id)
    .execute();
  const sizeRows = await f.db
    .insertInto('drop_sizes')
    .values(sizes.map((s, i) => ({ drop_id: id, label: s.label, position: i + 1, stock: s.stock })))
    .returning(['id', 'label', 'stock', 'position'])
    .execute();
  const addonRows = o.addons?.length
    ? await f.db
        .insertInto('live_addons')
        .values(o.addons.map((a, i) => ({ drop_id: id, label: a.label, line: a.line ?? null, price_minor: a.priceMinor, position: i + 1 })))
        .returning(['id', 'label', 'price_minor', 'position'])
        .execute()
    : [];
  if (o.windows?.length) {
    await f.db
      .insertInto('live_tier_windows')
      .values(o.windows.map((w) => ({ drop_id: id, tier: w.tier, turn_seconds: w.turnSeconds ?? null, pay_minutes: w.payMinutes ?? null })))
      .execute();
  }
  if (o.accessModels?.length) await f.db.insertInto('live_access_models').values(o.accessModels.map((m) => ({ drop_id: id, model_id: m }))).execute();
  if (o.afterRoom) await f.liveConsole.update(id, { afterRoom: o.afterRoom }, f.admin);
  if (o.published !== false) await f.db.updateTable('drops').set({ published_at: f.clock.now() }).where('id', '=', id).execute();
  const child = o.afterRoom ? await f.db.selectFrom('drops').select('id').where('parent_drop_id', '=', id).executeTakeFirstOrThrow() : null;
  return {
    id,
    sizes: sizeRows.sort((a, b) => a.position - b.position).map((s) => ({ id: s.id, label: s.label, stock: s.stock })),
    addons: addonRows.sort((a, b) => a.position - b.position).map((a) => ({ id: a.id, label: a.label, priceMinor: a.price_minor })),
    afterRoom: child ? { id: child.id, ...(await offerOf(f.db, child.id)) } : null,
  };
}

/** A release's sizes and add-ons, in order. */
export async function offerOf(db: Db, dropId: string) {
  const [sizes, addons] = await Promise.all([
    db.selectFrom('drop_sizes').select(['id', 'label', 'stock']).where('drop_id', '=', dropId).orderBy('position').execute(),
    db.selectFrom('live_addons').select(['id', 'label', 'price_minor']).where('drop_id', '=', dropId).orderBy('position').execute(),
  ]);
  return { sizes, addons: addons.map((a) => ({ id: a.id, label: a.label, priceMinor: a.price_minor })) };
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
