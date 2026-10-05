/**
 * The after-room (plan LIVE RELEASE+, choice 2 and decision 28; services/after-room.ts, migration 0023), against a
 * migrated database and a manual clock:
 *
 *  - its settings, with the release's (LiveConsoleService): a child LIVE RELEASE, a DRAFT, its own model, price, sizes
 *    and stock, add-ons, delay and length within their bounds, the rest the release's and kept in step with it; removed
 *    when turned off; never listed, set, published, cancelled or given a board on its own;
 *  - the sell-out: the entries still WAITING or QUEUED remembered in their order in the line, the after-room published
 *    at the sell-out, its T0 its delay later, its close its length after that; never opened otherwise (CLOSED, ENDED,
 *    cancelled, nobody waiting);
 *  - its guests alone, from its T0: anyone else, and a guest before it, read an unknown release, on every action and
 *    every surface (the list, the banner, the page, the .ics, the board, the circle);
 *  - the line at the guests' places, turns in that order size by size, the same hold, add-ons and PAY, the parent's
 *    per-tier windows; its orders at its price with the parent's location and surprise; closed at its length or its own
 *    sell-out, without an after-room of its own;
 *  - the parent's page tells its guests when the second door appears; MY PIECES and the right of access.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { DomainError } from '../../src/server/errors.js';
import { afterRoomTimes, afterRoomTitle, AFTER_ROOM_DELAY_MINUTES, AFTER_ROOM_LENGTH_MINUTES } from '../../src/server/services/after-room.js';
import { CircleService } from '../../src/server/services/circle.js';
import { accountLiveData } from '../../src/server/services/live.js';
import { LiveRoomService } from '../../src/server/services/live-room.js';
import type { Actor } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { accountOfTier, createLiveRelease, createModel, entriesOf, liveFixture, type LiveFixture, type LiveRelease } from '../support/live.js';

const T0 = new Date('2026-11-02T10:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const SECOND = 1000;
const MINUTE = 60_000;

async function rejects(p: Promise<unknown>, code: string, status?: number): Promise<DomainError> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e, code).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  if (status !== undefined) expect((e as DomainError).httpStatus).toBe(status);
  return e as DomainError;
}

describe('the after-room', () => {
  let t: TestDb;
  let f: LiveFixture;
  let room: LiveRoomService;
  let afterModel: string;

  beforeAll(async () => {
    t = await createTestDb();
    f = await liveFixture(t.db, '2026-11-01T09:00:00.000Z');
    room = new LiveRoomService({ db: t.db, turnKey: f.turnKey, publicOrigin: 'https://verify.orbes.test', clock: f.clock.now });
    afterModel = await createModel(t.db, 'AFTERGLOW');
  });
  afterAll(() => t.close());

  const AFTER = (o: Partial<{ stock: number; delayMinutes: number; lengthMinutes: number }> = {}) => ({
    modelId: afterModel,
    priceMinor: 90_000,
    sizes: [{ label: 'ONE SIZE', stock: o.stock ?? 1 }],
    addons: [{ label: 'GIFT BOX', priceMinor: 5_000 }],
    ...(o.delayMinutes !== undefined ? { delayMinutes: o.delayMinutes } : {}),
    ...(o.lengthMinutes !== undefined ? { lengthMinutes: o.lengthMinutes } : {}),
  });
  /** A release published the day before, its room open from 09:55, T0 at 10:00, closing at 11:00, with an after-room. */
  const release = (o: Partial<Parameters<typeof createLiveRelease>[1]> = {}) => {
    f.clock.set('2026-11-01T09:00:00.000Z');
    return createLiveRelease(f, { opensAt: T0, sizes: [{ label: '52', stock: 2 }], afterRoom: AFTER(), ...o });
  };
  const childOf = (r: LiveRelease) => t.db.selectFrom('drops').selectAll().where('id', '=', r.afterRoom!.id).executeTakeFirstOrThrow();
  const entry = (dropId: string, accountId: string) => t.db.selectFrom('live_entries').selectAll().where('drop_id', '=', dropId).where('account_id', '=', accountId).executeTakeFirstOrThrow();
  const audits = async (dropId: string, prefix: string) =>
    (await t.db.selectFrom('audit_logs').select(['action', 'actor_type', 'details']).where('target_id', '=', dropId).where('action', 'like', `${prefix}%`).orderBy('id').execute()).map((a) => ({
      action: a.action,
      actor: a.actor_type,
      details: a.details as Record<string, unknown>,
    }));
  const holdAndSecure = async (dropId: string, accountId: string, actor: Actor) => {
    const token = (await f.live.entry(accountId, dropId))!.turn!.token!;
    await f.live.press(accountId, dropId, token);
    f.clock.advance(1500);
    return f.live.secure(accountId, dropId, token, actor);
  };
  /** Five accounts enter the room in size 52; at T0 the line forms; the first two secure and pay: SOLD OUT. */
  async function sellOut(r: LiveRelease) {
    const people = [await accountOfTier(f, 3), await accountOfTier(f, 2), await accountOfTier(f, 1), await accountOfTier(f, 0), await accountOfTier(f, 0)];
    f.clock.set(at(-MINUTE));
    for (const p of people) await f.live.enter(p.id, r.id, { sizeId: r.sizes[0]!.id }, p.actor);
    f.clock.set(T0);
    await f.live.advance(r.id);
    const line = (await entriesOf(t.db, r.id)).map((e) => people.find((p) => p.id === e.account_id)!);
    for (const p of line.slice(0, 2)) {
      f.clock.advance(2 * SECOND);
      await holdAndSecure(r.id, p.id, p.actor);
      await f.live.confirm(p.id, r.id, p.actor);
    }
    const soldOutAt = (await entry(r.id, line[1]!.id)).confirmed_at!;
    return { buyers: line.slice(0, 2), guests: line.slice(2), soldOutAt };
  }

  describe('its settings, with the release', () => {
    it('is a child LIVE RELEASE, a DRAFT, its own model, price, sizes, add-ons, delay and length; the rest the release’s, kept in step', async () => {
      const r = await release({ turnSeconds: 40, payMinutes: 3, perAccount: 2 });
      const child = await childOf(r);
      expect(child).toMatchObject({
        mode: 'LIVE',
        parent_drop_id: r.id,
        model_id: afterModel,
        title: 'LIVE · THE AFTER-ROOM',
        price_minor: 90_000,
        currency: 'EUR',
        quantity: 1,
        quantity_line: '1 PIECE',
        turn_seconds: 40,
        pay_minutes: 3,
        per_account: 2,
        live_min_tier: 0,
        after_room_delay_minutes: AFTER_ROOM_DELAY_MINUTES.default,
        after_room_length_minutes: AFTER_ROOM_LENGTH_MINUTES.default,
        surprise_enabled: false,
        question_enabled: false,
        published_at: null,
        cancelled_at: null,
        stock_location_id: null,
      });
      // A DRAFT whose times say the latest it could open: the release's close plus its delay.
      expect({ opens: child.opens_at, closes: child.closes_at }).toEqual({ opens: at(70 * MINUTE), closes: at(85 * MINUTE) });
      expect(r.afterRoom!.sizes).toEqual([{ id: expect.any(String), label: 'ONE SIZE', stock: 1 }]);
      expect(r.afterRoom!.addons).toEqual([{ id: expect.any(String), label: 'GIFT BOX', priceMinor: 5_000 }]);
      // Its size is its model's SKU.
      const size = await t.db.selectFrom('drop_sizes as s').innerJoin('skus as k', 'k.id', 's.sku_id').select(['k.model_id', 'k.size_label']).where('s.drop_id', '=', child.id).executeTakeFirstOrThrow();
      expect(size).toEqual({ model_id: afterModel, size_label: 'ONE SIZE' });

      // Not listed on its own; the release's page shows it, its own page names the release it follows.
      const list = await f.liveConsole.list({ page: 1, pageSize: 100 });
      expect(list.items.map((x) => x.id)).toContain(r.id);
      expect(list.items.map((x) => x.id)).not.toContain(child.id);
      const parent = await f.liveConsole.get(r.id);
      expect(parent.afterRoom).toMatchObject({
        id: child.id,
        model: { id: afterModel, name: 'AFTERGLOW' },
        priceMinor: 90_000,
        currency: 'EUR',
        quantity: 1,
        delayMinutes: 10,
        lengthMinutes: 15,
        state: 'WAITING',
        phase: 'DRAFT',
        opensAt: null,
        closesAt: null,
        skipped: null,
        guests: 0,
      });
      expect(parent.afterRoomOf).toBeNull();
      const own = await f.liveConsole.get(child.id);
      expect(own).toMatchObject({ afterRoomOf: { id: r.id, title: 'LIVE' }, afterRoom: null, editable: false, phase: 'DRAFT' });
    });

    it('follows the release’s changes and its own until the announcement; turned off, it is removed', async () => {
      f.clock.set('2026-11-01T09:00:00.000Z');
      const created = await f.liveConsole.create(
        {
          modelId: f.modelId,
          title: 'NIGHT',
          opensAt: T0,
          closesAt: at(60 * MINUTE),
          priceMinor: 500_000,
          sizes: [{ label: '52', stock: 2 }],
          afterRoom: { ...AFTER({ delayMinutes: 5, lengthMinutes: 20 }), sizes: [{ label: '50', stock: 1 }, { label: '52', stock: 2 }] },
        },
        f.admin,
      );
      expect(created.afterRoom).toMatchObject({ delayMinutes: 5, lengthMinutes: 20, quantity: 3, sizes: [{ label: '50', stock: 1 }, { label: '52', stock: 2 }] });
      const child = created.afterRoom!.id;
      const kept = created.afterRoom!.sizes[1]!.id;
      // The release changes: its title, windows, limit and currency follow.
      const changed = await f.liveConsole.update(created.id, { title: 'NIGHT II', turnSeconds: 60, payMinutes: 2, perAccount: 3, currency: 'CHF', closesAt: at(90 * MINUTE) }, f.admin);
      expect(changed.afterRoom!.id).toBe(child);
      expect(await t.db.selectFrom('drops').select(['title', 'turn_seconds', 'pay_minutes', 'per_account', 'currency', 'opens_at']).where('id', '=', child).executeTakeFirstOrThrow()).toEqual({
        title: 'NIGHT II · THE AFTER-ROOM',
        turn_seconds: 60,
        pay_minutes: 2,
        per_account: 3,
        currency: 'CHF',
        opens_at: at(95 * MINUTE),
      });
      // Its own settings change, the ids it keeps kept; the audit log says before and after.
      const own = await f.liveConsole.update(created.id, { afterRoom: { modelId: afterModel, priceMinor: 70_000, sizes: [{ id: kept, label: '52', stock: 4 }], delayMinutes: 30 } }, f.admin);
      expect(own.afterRoom).toMatchObject({ id: child, priceMinor: 70_000, delayMinutes: 30, lengthMinutes: 20, sizes: [{ id: kept, label: '52', stock: 4 }], addons: [{ label: 'GIFT BOX' }] });
      const update = (await audits(created.id, 'drop.live.update')).at(-1)!;
      expect(update.details).toMatchObject({
        before: { afterRoom: { priceMinor: 90_000, sizes: ['50:1', '52:2'], delayMinutes: 5 } },
        after: { afterRoom: { priceMinor: 70_000, sizes: ['52:4'], delayMinutes: 30 } },
      });
      // The same again: nothing written.
      const n = (await audits(created.id, 'drop.live.update')).length;
      await f.liveConsole.update(created.id, { afterRoom: { modelId: afterModel, priceMinor: 70_000, sizes: [{ id: kept, label: '52', stock: 4 }] } }, f.admin);
      expect((await audits(created.id, 'drop.live.update')).length).toBe(n);
      // Bounds, as the release's own.
      await rejects(f.liveConsole.update(created.id, { afterRoom: { ...AFTER(), delayMinutes: 0 } }, f.admin), 'VALIDATION_FAILED', 400);
      await rejects(f.liveConsole.update(created.id, { afterRoom: { ...AFTER(), delayMinutes: 61 } }, f.admin), 'VALIDATION_FAILED', 400);
      await rejects(f.liveConsole.update(created.id, { afterRoom: { ...AFTER(), lengthMinutes: 4 } }, f.admin), 'VALIDATION_FAILED', 400);
      await rejects(f.liveConsole.update(created.id, { afterRoom: { ...AFTER(), lengthMinutes: 121 } }, f.admin), 'VALIDATION_FAILED', 400);
      await rejects(f.liveConsole.update(created.id, { afterRoom: { ...AFTER(), sizes: [] } }, f.admin), 'VALIDATION_FAILED', 400);
      await rejects(f.liveConsole.update(created.id, { afterRoom: { ...AFTER(), sizes: [{ label: '52', stock: 0 }] } }, f.admin), 'VALIDATION_FAILED', 400);
      await rejects(f.liveConsole.update(created.id, { afterRoom: { ...AFTER(), sizes: [{ id: r0(), label: '52', stock: 1 }] } }, f.admin), 'VALIDATION_FAILED', 400);
      await rejects(f.liveConsole.update(created.id, { afterRoom: { ...AFTER(), modelId: r0() } }, f.admin), 'MODEL_NOT_FOUND', 404);
      const retired = await createModel(t.db, 'RETIRED');
      await t.db.updateTable('models').set({ active: false }).where('id', '=', retired).execute();
      await rejects(f.liveConsole.update(created.id, { afterRoom: { ...AFTER(), modelId: retired } }, f.admin), 'MODEL_INACTIVE', 409);
      // Turned off: removed, with its sizes and add-ons.
      const off = await f.liveConsole.update(created.id, { afterRoom: null }, f.admin);
      expect(off.afterRoom).toBeNull();
      expect(await t.db.selectFrom('drops').select('id').where('id', '=', child).executeTakeFirst()).toBeUndefined();
      expect(await t.db.selectFrom('drop_sizes').select('id').where('drop_id', '=', child).execute()).toEqual([]);
      // Announced, it changes no more, as every setting.
      await f.liveConsole.update(created.id, { afterRoom: AFTER() }, f.admin);
      await f.liveConsole.publish(created.id, {}, f.admin);
      await rejects(f.liveConsole.update(created.id, { afterRoom: null }, f.admin), 'LIVE_ANNOUNCED', 409);
    });

    it('is never set, published, cancelled, posted in the circle nor given a board on its own', async () => {
      const r = await release({ published: false });
      const child = r.afterRoom!.id;
      await rejects(f.liveConsole.update(child, { priceMinor: 1 }, f.admin), 'LIVE_AFTER_ROOM', 409);
      await rejects(f.liveConsole.publish(child, {}, f.admin), 'LIVE_AFTER_ROOM', 409);
      await rejects(f.liveConsole.cancel(child, f.admin), 'LIVE_AFTER_ROOM', 409);
      await rejects(f.liveConsole.setCirclePost(child, true, f.admin), 'LIVE_AFTER_ROOM', 409);
      await rejects(f.live.issueBoardLink(child, f.admin), 'LIVE_AFTER_ROOM', 409);
      const circle = new CircleService({ db: t.db, audit: f.audit, clock: f.clock.now });
      await rejects(circle.create({ kind: 'NOTE', title: 'A SECOND DOOR', dropId: child }, f.admin), 'DROP_NOT_FOUND', 404);
      // Its release's model no longer offered blocks the publication, its after-room's too.
      await t.db.updateTable('models').set({ active: false }).where('id', '=', afterModel).execute();
      try {
        await rejects(f.liveConsole.publish(r.id, {}, f.admin), 'MODEL_INACTIVE', 409);
      } finally {
        await t.db.updateTable('models').set({ active: true }).where('id', '=', afterModel).execute();
      }
      // Cancelled with its release: it never opens.
      await f.liveConsole.cancel(r.id, f.admin);
      expect((await childOf(r)).cancelled_at).toEqual(f.clock.now());
      expect((await f.liveConsole.get(r.id)).afterRoom).toMatchObject({ state: 'NOT_OPENED', skipped: 'CANCELLED' });
      expect(await audits(r.id, 'drop.live.after_room')).toEqual([{ action: 'drop.live.after_room.skip', actor: 'admin', details: { afterRoomId: child, reason: 'CANCELLED' } }]);
    });
  });

  describe('the sell-out', () => {
    it('remembers those still in the line, in their order, and opens the after-room for them alone, its delay later', async () => {
      const r = await release();
      const child = r.afterRoom!.id;
      const { buyers, guests, soldOutAt } = await sellOut(r);
      const parentLine = await entriesOf(t.db, r.id);
      expect(parentLine.filter((e) => e.status === 'ENDED').map((e) => e.account_id)).toEqual(guests.map((g) => g.id));
      const remembered = await t.db.selectFrom('after_room_guests').selectAll().where('drop_id', '=', child).orderBy('position').execute();
      expect(remembered.map((g) => [g.entry_id, g.position, g.remembered_at])).toEqual(
        parentLine.filter((e) => e.status === 'ENDED').map((e, i) => [e.id, i + 1, soldOutAt]),
      );
      const times = afterRoomTimes(soldOutAt, 10, 15);
      expect(await childOf(r)).toMatchObject({ published_at: soldOutAt, opens_at: times.opensAt, closes_at: times.closesAt, cancelled_at: null });
      expect(await audits(r.id, 'drop.live.after_room')).toEqual([
        { action: 'drop.live.after_room.open', actor: 'system', details: { afterRoomId: child, guests: 3, opensAt: times.opensAt.toISOString(), closesAt: times.closesAt.toISOString() } },
      ]);
      // The audit log names no entry, no account.
      expect(JSON.stringify(await audits(r.id, 'drop.live.after_room'))).not.toMatch(/entry|account/i);
      expect((await f.liveConsole.get(r.id)).afterRoom).toMatchObject({ state: 'OPENS', opensAt: times.opensAt, closesAt: times.closesAt, guests: 3 });

      // Before its T0: an unknown release, to its guests too; the parent tells its guests when the door appears.
      // The release's page says the second door through the account's own entry there (its own; the stream's too).
      const door = (accountId: string) => room.viewer(accountId, r.id, 'state').then((v) => room.own(accountId, v)).then((o) => o.entry?.afterRoom ?? null);
      f.clock.set(new Date(times.opensAt.getTime() - SECOND));
      for (const p of [...guests, ...buyers]) {
        await rejects(f.live.enter(p.id, child, { sizeId: r.afterRoom!.sizes[0]!.id }, p.actor), 'DROP_NOT_FOUND', 404);
        await rejects(room.viewer(p.id, child, 'state'), 'DROP_NOT_FOUND', 404);
        await rejects(room.afterRoomSheet(p.id, r.id), 'DROP_NOT_FOUND', 404);
      }
      for (const g of guests) expect(await door(g.id)).toEqual({ opensAt: times.opensAt, closesAt: times.closesAt });
      expect(await door(buyers[0]!.id)).toBeNull();
      expect((await room.viewerEntries(r.id, [guests[1]!.id, buyers[1]!.id])).get(buyers[1]!.id)!.afterRoom).toBeNull();

      // From its T0: its guests, and nobody else.
      f.clock.set(times.opensAt);
      expect(await door(guests[0]!.id)).toEqual({ opensAt: times.opensAt, closesAt: times.closesAt });
      expect(await door(buyers[1]!.id)).toBeNull();
      for (const p of buyers) {
        await rejects(f.live.enter(p.id, child, { sizeId: r.afterRoom!.sizes[0]!.id }, p.actor), 'DROP_NOT_FOUND', 404);
        await rejects(room.viewer(p.id, child, 'stream'), 'DROP_NOT_FOUND', 404);
        await rejects(room.afterRoomSheet(p.id, r.id), 'DROP_NOT_FOUND', 404);
      }
      const stranger = await accountOfTier(f, 3);
      await rejects(f.live.enter(stranger.id, child, { sizeId: r.afterRoom!.sizes[0]!.id }, stranger.actor), 'DROP_NOT_FOUND', 404);
      await rejects(f.live.access(stranger.id, child), 'DROP_NOT_FOUND', 404);
      const sheet = await room.afterRoomSheet(guests[0]!.id, r.id);
      expect(sheet).toMatchObject({ id: child, kind: 'LIVE', phase: 'LIVE', name: 'AFTERGLOW', priceMinor: 90_000, quantityLine: '1 PIECE', afterRoom: { parentId: r.id } });
      expect('sizes' in sheet && sheet.sizes).toEqual([{ id: r.afterRoom!.sizes[0]!.id, label: 'ONE SIZE', stock: 1 }]);
      expect('addons' in sheet && sheet.addons).toEqual([{ id: r.afterRoom!.addons[0]!.id, label: 'GIFT BOX', line: null, priceMinor: 5_000 }]);
      // On no public surface: the list, the banner, its page, its .ics, a board.
      expect((await room.list()).map((x) => x.id)).not.toContain(child);
      expect((await room.next())?.id).not.toBe(child);
      await rejects(room.sheet(child), 'DROP_NOT_FOUND', 404);
      await rejects(room.calendar(child), 'DROP_NOT_FOUND', 404);
      await rejects(room.board(child, 'A'.repeat(43)), 'DROP_NOT_FOUND', 404);
      expect(await room.frame(child)).not.toBeNull();
    });

    it('turns follow the guests’ places, with the release’s windows; the same hold, add-ons and PAY; its orders at its price, the release’s location and surprise; closed at its own sell-out', async () => {
      // The release's per-tier windows (every tier: 20 s to hold the seal) are the after-room's.
      const r = await release({ windows: [0, 1, 2, 3].map((tier) => ({ tier, turnSeconds: 20 })) });
      const child = r.afterRoom!.id;
      await t.db.updateTable('drops').set({ surprise_enabled: true, surprise_text: 'A silk pouch, hand-stitched.' }).where('id', '=', r.id).execute();
      const { guests, soldOutAt } = await sellOut(r);
      const opensAt = afterRoomTimes(soldOutAt, 10, 15).opensAt;
      const places = new Map(
        (await t.db.selectFrom('after_room_guests as g').innerJoin('live_entries as e', 'e.id', 'g.entry_id').select(['e.account_id', 'g.position']).where('g.drop_id', '=', child).execute()).map((g) => [g.account_id, g.position]),
      );
      const [first, second, third] = guests;
      const size = r.afterRoom!.sizes[0]!.id;
      // The third in line enters first, then the first: each at its own place, the size never changing.
      f.clock.set(new Date(opensAt.getTime() + 5 * SECOND));
      const late = await f.live.enter(third!.id, child, { sizeId: size }, third!.actor);
      expect(late).toMatchObject({ status: 'QUEUED', position: places.get(third!.id), size: { label: 'ONE SIZE' } });
      f.clock.advance(SECOND);
      await f.live.enter(first!.id, child, { sizeId: size }, first!.actor);
      expect((await entry(child, first!.id)).position).toBe(1);
      await rejects(f.live.changeSize(first!.id, child, { sizeId: size }, first!.actor), 'LIVE_SIZE_LOCKED', 409);
      // The engine: the one piece goes to the first place, with the release's per-tier window.
      f.clock.advance(SECOND);
      await f.live.advance(child);
      const turn = await entry(child, first!.id);
      expect(turn).toMatchObject({ status: 'TURN', turn_at: f.clock.now() });
      expect(turn.turn_expires_at!.getTime() - turn.turn_at!.getTime()).toBe(20 * SECOND);
      expect((await childOf(r)).turn_seconds).toBe(30);
      expect((await entry(child, third!.id)).status).toBe('QUEUED');
      // A hold too short, then the seal held; the add-on; PAY.
      const token = (await f.live.entry(first!.id, child))!.turn!.token!;
      await f.live.press(first!.id, child, token);
      f.clock.advance(900);
      await rejects(f.live.secure(first!.id, child, token, first!.actor), 'LIVE_HOLD_TOO_SHORT', 409);
      f.clock.advance(600);
      await f.live.secure(first!.id, child, token, first!.actor);
      const withAddon = await f.live.setAddons(first!.id, child, [r.afterRoom!.addons[0]!.id], first!.actor);
      expect(withAddon).toMatchObject({ status: 'SECURED', priceMinor: 90_000, totalMinor: 95_000, currency: 'EUR' });
      await f.live.confirm(first!.id, child, first!.actor);
      const order = await t.db.selectFrom('orders').selectAll().where('drop_id', '=', child).executeTakeFirstOrThrow();
      const location = await t.db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow();
      expect(order).toMatchObject({
        channel: 'LIVE',
        account_id: first!.id,
        model_id: afterModel,
        price_minor: 90_000,
        currency: 'EUR',
        surprise: 'A silk pouch, hand-stitched.',
        location_id: location.id,
        status: 'RESERVED',
      });
      expect(order.addons).toEqual([{ id: r.afterRoom!.addons[0]!.id, label: 'GIFT BOX', priceMinor: 5_000 }]);
      // Its own sell-out: closed, the one still waiting ENDED; no after-room of its own; the second guest never came.
      const ended = await childOf(r);
      expect(ended).toMatchObject({ ended_reason: 'SOLD_OUT' });
      expect((await entry(child, third!.id)).status).toBe('ENDED');
      expect(await t.db.selectFrom('live_entries').select('id').where('drop_id', '=', child).where('account_id', '=', second!.id).executeTakeFirst()).toBeUndefined();
      expect(await audits(child, 'drop.live.after_room')).toEqual([]);
      // Over: the door is gone from the parent's page; its guest reads that it is over, with its own entry.
      expect((await room.viewerEntries(r.id, [first!.id])).get(first!.id)!.afterRoom).toBeNull();
      expect(await room.afterRoomSheet(first!.id, r.id)).toEqual({ id: child, kind: 'LIVE', phase: 'ENDED', afterRoom: { parentId: r.id } });
      expect((await room.viewer(first!.id, child, 'state')).entry).toBe('CONFIRMED');
      expect((await f.liveConsole.get(r.id)).afterRoom).toMatchObject({ state: 'OVER', endedReason: 'SOLD_OUT', entries: { CONFIRMED: 1, ENDED: 1 } });
      // MY PIECES: the after-room's entry names the release it follows; the right of access keeps the place.
      const mine = await room.mine(first!.id);
      expect(mine.find((x) => x.release.id === child)!.release).toMatchObject({ afterRoomOf: r.id, title: 'LIVE · THE AFTER-ROOM', name: 'AFTERGLOW' });
      expect(mine.find((x) => x.release.id === r.id)!.release.afterRoomOf).toBeNull();
      const exported = await accountLiveData(t.db, first!.id);
      expect(exported.entries.find((x) => x.dropId === r.id)!.afterRoomPlace).toBe(1);
      expect(exported.entries.find((x) => x.dropId === child)!.afterRoomPlace).toBeNull();
    });

    it('closes at its length: nobody waits on after it, a hold still running may be paid until its deadline', async () => {
      const r = await release({ turnSeconds: 300, afterRoom: AFTER({ stock: 2, lengthMinutes: 5 }) });
      const child = r.afterRoom!.id;
      const { guests, soldOutAt } = await sellOut(r);
      const { opensAt, closesAt } = afterRoomTimes(soldOutAt, 10, 5);
      f.clock.set(opensAt);
      for (const g of guests) await f.live.enter(g.id, child, { sizeId: r.afterRoom!.sizes[0]!.id }, g.actor);
      await f.live.advance(child);
      const line = (await entriesOf(t.db, child)).map((e) => guests.find((g) => g.id === e.account_id)!);
      expect((await entriesOf(t.db, child)).map((e) => [e.position, e.status])).toEqual([[1, 'TURN'], [2, 'TURN'], [3, 'QUEUED']]);
      f.clock.advance(2 * SECOND);
      await holdAndSecure(child, line[0]!.id, line[0]!.actor);
      f.clock.set(closesAt);
      await f.live.advance(child);
      expect(await childOf(r)).toMatchObject({ ended_reason: 'CLOSED', ended_at: closesAt });
      expect((await entriesOf(t.db, child)).map((e) => e.status)).toEqual(['SECURED', 'MISSED', 'ENDED']);
      // Its guests' door is gone once it has closed; a hold still running is paid after the close.
      // (its time over, the page hides it; the engine's CLOSED takes it from the entry)
      expect((await room.viewerEntries(r.id, [guests[0]!.id])).get(guests[0]!.id)!.afterRoom).toBeNull();
      f.clock.advance(SECOND);
      expect(await f.live.confirm(line[0]!.id, child, line[0]!.actor)).toMatchObject({ status: 'CONFIRMED' });
    });

    it('never opens when the release closes or ends without selling out, nor when nobody was waiting', async () => {
      // CLOSED: some waited, but the release did not sell out.
      const closed = await release({ closesAt: at(MINUTE) });
      const a = await accountOfTier(f, 0);
      f.clock.set(at(-MINUTE));
      await f.live.enter(a.id, closed.id, { sizeId: closed.sizes[0]!.id }, a.actor);
      f.clock.set(at(2 * MINUTE));
      await f.live.advance(closed.id);
      expect(await childOf(closed)).toMatchObject({ published_at: null, cancelled_at: at(MINUTE) });
      expect(await audits(closed.id, 'drop.live.after_room')).toEqual([{ action: 'drop.live.after_room.skip', actor: 'system', details: { afterRoomId: closed.afterRoom!.id, reason: 'NOT_SOLD_OUT' } }]);
      expect(await t.db.selectFrom('after_room_guests').select('entry_id').where('drop_id', '=', closed.afterRoom!.id).execute()).toEqual([]);
      expect((await f.liveConsole.get(closed.id)).afterRoom).toMatchObject({ state: 'NOT_OPENED', skipped: 'NOT_SOLD_OUT' });

      // ENDED by an ADMIN.
      const ended = await release();
      f.clock.set(at(-MINUTE));
      await f.live.enter(a.id, ended.id, { sizeId: ended.sizes[0]!.id }, a.actor);
      f.clock.set(at(5 * SECOND));
      await f.live.end(ended.id, f.admin);
      expect((await childOf(ended)).cancelled_at).toEqual(at(5 * SECOND));
      expect((await audits(ended.id, 'drop.live.after_room')).map((x) => [x.actor, x.details.reason])).toEqual([['admin', 'NOT_SOLD_OUT']]);

      // SOLD OUT with nobody left in the line.
      const empty = await release({ sizes: [{ label: '52', stock: 1 }] });
      f.clock.set(at(-MINUTE));
      await f.live.enter(a.id, empty.id, { sizeId: empty.sizes[0]!.id }, a.actor);
      f.clock.set(T0);
      await f.live.advance(empty.id);
      await holdAndSecure(empty.id, a.id, a.actor);
      await f.live.confirm(a.id, empty.id, a.actor);
      const soldOut = (await entry(empty.id, a.id)).confirmed_at!;
      expect(await childOf(empty)).toMatchObject({ ended_reason: null, published_at: null, cancelled_at: soldOut });
      expect((await audits(empty.id, 'drop.live.after_room')).map((x) => x.details.reason)).toEqual(['NO_GUESTS']);
      expect((await f.liveConsole.get(empty.id)).afterRoom).toMatchObject({ state: 'NOT_OPENED', skipped: 'NO_GUESTS' });
      // Not opened, it stays unknown to everyone.
      f.clock.set(at(30 * MINUTE));
      await rejects(room.afterRoomSheet(a.id, empty.id), 'DROP_NOT_FOUND', 404);
      expect(await f.live.liveReleaseIds()).not.toContain(empty.afterRoom!.id);
    });
  });

  it('a migration constraint keeps it a child of a LIVE release without rules, reveals, board or question of its own', async () => {
    const r = await release({ published: false });
    const child = r.afterRoom!.id;
    for (const [column, value] of [
      ['live_min_tier', 1],
      ['surprise_enabled', true],
      ['question_enabled', true],
      ['min_participations', 2],
      ['access_combine', 'OR'],
      ['announce_at', new Date('2026-11-01T12:00:00Z')],
      ['after_room_delay_minutes', null],
    ] as const) {
      await expect(t.db.updateTable('drops').set({ [column]: value }).where('id', '=', child).execute(), column).rejects.toThrow(/check constraint/);
    }
    await expect(t.db.updateTable('drops').set({ parent_drop_id: child }).where('id', '=', child).execute()).rejects.toThrow(/check constraint/);
    // A draw has none of it; a release, one after-room at most.
    const lone = await createLiveRelease(f, { opensAt: T0, published: false });
    const draw = await f.drops.create({ modelId: f.modelId, title: 'A draw', quantity: 1, opensAt: T0, closesAt: at(MINUTE) }, f.admin);
    await expect(sql`UPDATE drops SET parent_drop_id = ${lone.id}, after_room_delay_minutes = 10, after_room_length_minutes = 15 WHERE id = ${draw.id}`.execute(t.db)).rejects.toThrow(/check constraint/);
    await expect(
      sql`UPDATE drops SET parent_drop_id = ${r.id}, after_room_delay_minutes = 10, after_room_length_minutes = 15, surprise_enabled = false, question_enabled = false WHERE id = ${lone.id}`.execute(t.db),
    ).rejects.toThrow(/duplicate key|unique/);
    expect(afterRoomTitle('x'.repeat(120))).toHaveLength(120);
    expect(afterRoomTitle('NIGHT')).toBe('NIGHT · THE AFTER-ROOM');
  });
});

/** An id no row has. */
function r0(): string {
  return '00000000-0000-4000-8000-000000000000';
}
