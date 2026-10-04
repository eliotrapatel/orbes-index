/**
 * The LIVE RELEASE's domain (services/live.ts, migration 0021), against a migrated database and a manual clock:
 *
 *  - its rules, pure: the room's opening, the announcement, the phases, the deadlines moved by a pause, the per-tier
 *    windows, the line at T0 (tier, then sha256(seed ‖ id)), the turn's secret, the network's prefix and hash, the rule
 *    in words;
 *  - the room: ENTER (announced, room open, the rule, a size with stock, a quantity within `per_account`), one entry per
 *    account, CHANGE SIZE before T0 only, LEAVE and enter again before T0; I'LL BE THERE until T0; the draw's paths
 *    know nothing of a LIVE release;
 *  - access by tier, by the models held and by a collection, read again at SECURE;
 *  - T0: the line by tier then seed (or the seed alone), the tier read at T0, late arrivals behind by arrival;
 *  - turns per size by quantity, PRESS and SECURE (its secret, 1.4 s on the server's clock, a running turn), the
 *    per-tier windows, add-ons and the total, PAY, RELEASE, the second chance after a miss, a hold that ends, a release,
 *    a leave, a freed hold and a removal;
 *  - the console's controls: PAUSE and RESUME (no turn, frozen deadlines, moved on resume), EXTEND, ADD PIECES, LET IN,
 *    a host message, END NOW, REMOVE;
 *  - the three ends with their exact effects (SOLD_OUT, CLOSED, ENDED), then the release over;
 *  - a lock of an account (its open entries removed, its interest before T0 withdrawn), the right-of-access export,
 *    the network's hash erased 30 days after the end; the audit log by ids, never an email.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { DomainError } from '../../src/server/errors.js';
import { drawKey, openDropSeed } from '../../src/server/services/drops.js';
import {
  accessOf,
  announcedAt,
  effectiveDeadline,
  eraseLiveNetworkHashes,
  lineOrder,
  liveNetworkHash,
  liveNetworkPrefix,
  livePhase,
  liveRuleText,
  liveTurnToken,
  pausedFor,
  roomOpensAt,
  turnTokenHash,
  windowsFor,
  LIVE_GESTURE_MIN_MS,
} from '../../src/server/services/live.js';
import { LifecycleService } from '../../src/server/services/lifecycle.js';
import { OwnershipService } from '../../src/server/services/ownership.js';
import { OwnerService } from '../../src/server/services/owners.js';
import { SessionService } from '../../src/server/services/sessions.js';
import type { Actor } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import {
  accountOfTier,
  createAccount,
  createCollection,
  createLiveRelease,
  createModel,
  entriesOf,
  holdPieces,
  liveFixture,
  type LiveFixture,
  type LiveRelease,
} from '../support/live.js';

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

describe('the rules of a LIVE RELEASE', () => {
  const d = {
    published_at: new Date('2026-11-01T09:00:00Z'),
    cancelled_at: null,
    announce_at: null as Date | null,
    opens_at: T0,
    closes_at: at(60 * MINUTE),
    room_opens_minutes: 5,
    ended_at: null as Date | null,
  };

  it('opens its room before T0, is announced at its announcement or publication, and goes through its phases', () => {
    expect(roomOpensAt(d)).toEqual(at(-5 * MINUTE));
    expect(announcedAt(d)).toEqual(d.published_at);
    expect(announcedAt({ ...d, announce_at: new Date('2026-11-01T12:00:00Z') })).toEqual(new Date('2026-11-01T12:00:00Z'));
    expect(announcedAt({ ...d, published_at: null })).toBeNull();
    const later = { ...d, announce_at: new Date('2026-11-01T12:00:00Z') };
    expect(livePhase(later, new Date('2026-11-01T11:00:00Z'))).toBe('HIDDEN');
    expect(livePhase(later, new Date('2026-11-01T12:00:00Z'))).toBe('ANNOUNCED');
    expect(livePhase(d, at(-5 * MINUTE))).toBe('ROOM');
    expect(livePhase(d, T0)).toBe('LIVE');
    expect(livePhase(d, at(60 * MINUTE))).toBe('ENDED');
    expect(livePhase({ ...d, ended_at: at(MINUTE) }, at(2 * MINUTE))).toBe('ENDED');
    expect(livePhase({ ...d, published_at: null }, T0)).toBe('DRAFT');
    expect(livePhase({ ...d, cancelled_at: T0 }, T0)).toBe('CANCELLED');
  });

  it('moves a deadline by the pause in progress, never by a pause that is over', () => {
    const deadline = at(30 * SECOND);
    expect(pausedFor({ paused_at: null }, at(MINUTE))).toBe(0);
    expect(effectiveDeadline(deadline, { paused_at: null }, at(MINUTE))).toEqual(deadline);
    expect(pausedFor({ paused_at: at(10 * SECOND) }, at(25 * SECOND))).toBe(15 * SECOND);
    expect(effectiveDeadline(deadline, { paused_at: at(10 * SECOND) }, at(25 * SECOND))).toEqual(at(45 * SECOND));
  });

  it('takes the turn and pay windows of a tier when it overrides them', () => {
    const release = { turn_seconds: 30, pay_minutes: 5 };
    const overrides = [{ tier: 3, turn_seconds: null, pay_minutes: 10 }, { tier: 2, turn_seconds: 60, pay_minutes: null }];
    expect(windowsFor(release, overrides, 3)).toEqual({ turnSeconds: 30, payMinutes: 10 });
    expect(windowsFor(release, overrides, 2)).toEqual({ turnSeconds: 60, payMinutes: 5 });
    expect(windowsFor(release, overrides, 0)).toEqual({ turnSeconds: 30, payMinutes: 5 });
  });

  it('orders the line at T0 by tier, then by sha256(seed ‖ id), then by id; by the seed alone without tier priority', () => {
    const seed = new Uint8Array(32).map((_, i) => i * 7);
    const entries = Array.from({ length: 12 }, (_, i) => ({ id: `0000000${i.toString(16)}-0000-4000-8000-00000000000${i % 10}`, tier: i % 4 }));
    const byTier = lineOrder(entries, seed, true);
    for (let i = 1; i < byTier.length; i++) {
      const [a, b] = [byTier[i - 1]!, byTier[i]!];
      expect(a.tier > b.tier || (a.tier === b.tier && drawKey(seed, a.id) < drawKey(seed, b.id))).toBe(true);
    }
    const bySeed = lineOrder(entries, seed, false);
    for (let i = 1; i < bySeed.length; i++) expect(drawKey(seed, bySeed[i - 1]!.id) < drawKey(seed, bySeed[i]!.id)).toBe(true);
    // Pure: the same entries in another order give the same line.
    expect(lineOrder([...entries].reverse(), seed, true)).toEqual(byTier);
  });

  it('gives a turn a secret bound to its entry and its start, stored as its SHA-256', () => {
    const key = new Uint8Array(32).fill(3);
    const id = '6f1c0a4e-2b7d-4c1e-9a3f-5d8e7b6a4c21';
    const token = liveTurnToken(key, id, T0);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(liveTurnToken(key, id.toUpperCase(), new Date(T0))).toBe(token);
    expect(liveTurnToken(key, id, at(1))).not.toBe(token);
    expect(liveTurnToken(new Uint8Array(32).fill(4), id, T0)).not.toBe(token);
    expect(turnTokenHash(token)).toHaveLength(32);
  });

  it('groups an address by its network (/24, /48) and keeps only a keyed hash of it', () => {
    expect(liveNetworkPrefix('203.0.113.77')).toBe('203.0.113.0/24');
    expect(liveNetworkPrefix('::ffff:203.0.113.9')).toBe('203.0.113.0/24');
    expect(liveNetworkPrefix('2001:db8:abcd:12:1::5')).toBe('2001:db8:abcd::/48');
    const pepper = 'p'.repeat(40);
    expect(liveNetworkHash(pepper, '203.0.113.77')).toEqual(liveNetworkHash(pepper, '203.0.113.1'));
    expect(liveNetworkHash(pepper, '203.0.113.77')).not.toEqual(liveNetworkHash(pepper, '203.0.114.77'));
    expect(liveNetworkHash('q'.repeat(40), '203.0.113.77')).not.toEqual(liveNetworkHash(pepper, '203.0.113.77'));
    expect(liveNetworkHash(pepper, '203.0.113.77')).toHaveLength(32);
  });

  it('says its rule in words', () => {
    const none = { models: [], collection: null };
    expect(liveRuleText({ minTier: 0, ...none })).toBe('every ORBES account');
    expect(liveRuleText({ minTier: 1, ...none })).toBe('owners');
    expect(liveRuleText({ minTier: 2, ...none })).toBe('owners from PLATINE');
    expect(liveRuleText({ minTier: 3, ...none })).toBe('owners from PALLADIUM');
    const monolithe = { id: 'm', name: 'MONOLITHE' };
    expect(liveRuleText({ minTier: 0, models: [monolithe], collection: null })).toBe('owners of MONOLITHE');
    expect(liveRuleText({ minTier: 2, models: [monolithe, { id: 'n', name: 'ORBIT' }], collection: { id: 'c', name: 'GENESIS' } })).toBe(
      'owners from PLATINE of MONOLITHE, ORBIT or the GENESIS collection',
    );
  });
});

describe('LiveService', () => {
  let t: TestDb;
  let f: LiveFixture;

  beforeAll(async () => {
    t = await createTestDb();
    f = await liveFixture(t.db, '2026-11-01T09:00:00.000Z');
  });
  afterAll(() => t.close());

  /** A release published at 2026-11-01 09:00, its room open from 09:55 the next day, T0 at 10:00, closing at 11:00. */
  const release = (o: Partial<Parameters<typeof createLiveRelease>[1]> = {}) => {
    f.clock.set('2026-11-01T09:00:00.000Z');
    return createLiveRelease(f, { opensAt: T0, ...o });
  };
  const entry = (dropId: string, accountId: string) => t.db.selectFrom('live_entries').selectAll().where('drop_id', '=', dropId).where('account_id', '=', accountId).executeTakeFirstOrThrow();
  const advance = async (r: LiveRelease, when: Date) => {
    f.clock.set(when);
    return f.live.advance(r.id);
  };
  const audits = async (dropId: string) =>
    (await t.db.selectFrom('audit_logs').select(['action', 'actor_type', 'actor_id', 'details']).where('target_id', '=', dropId).orderBy('id').execute()).map((a) => ({
      action: a.action,
      actor: a.actor_type,
      details: a.details as Record<string, unknown>,
    }));
  /** The account's turn: its secret, read as its own screen reads it. */
  const tokenOf = async (dropId: string, accountId: string) => (await f.live.entry(accountId, dropId))!.turn!.token!;
  /** PRESS, then SECURE `holdMs` later. */
  const holdAndSecure = async (dropId: string, accountId: string, actor: Actor, holdMs = 1500) => {
    const token = await tokenOf(dropId, accountId);
    await f.live.press(accountId, dropId, token);
    f.clock.advance(holdMs);
    return f.live.secure(accountId, dropId, token, actor);
  };

  describe('the room', () => {
    it('is entered from its opening, announced and allowed in, with a size of the release, once per account', async () => {
      const r = await release({ sizes: [{ label: '50', stock: 1 }, { label: '52', stock: 2 }, { label: '54', stock: 0 }], perAccount: 2, announceAt: new Date('2026-11-01T12:00:00Z') });
      const a = await accountOfTier(f, 1);
      // Not announced yet: as unknown as a release that does not exist; an id that is not a LIVE release, likewise.
      f.clock.set('2026-11-01T11:00:00Z');
      await rejects(f.live.enter(a.id, r.id, { sizeId: r.sizes[1]!.id }, a.actor), 'DROP_NOT_FOUND', 404);
      await rejects(f.live.setInterest(a.id, r.id, r.sizes[1]!.id, a.actor), 'DROP_NOT_FOUND', 404);
      await rejects(f.live.enter(a.id, '00000000-0000-4000-8000-000000000000', { sizeId: r.sizes[1]!.id }, a.actor), 'DROP_NOT_FOUND', 404);
      const draw = await f.drops.create({ modelId: f.modelId, title: 'A draw', quantity: 1, opensAt: T0, closesAt: at(MINUTE) }, f.admin);
      await f.drops.publish(draw.id, f.admin);
      await rejects(f.live.enter(a.id, draw.id, { sizeId: r.sizes[1]!.id }, a.actor), 'DROP_NOT_FOUND', 404);
      // Announced, the room not open yet.
      f.clock.set(at(-5 * MINUTE - 1));
      await rejects(f.live.enter(a.id, r.id, { sizeId: r.sizes[1]!.id }, a.actor), 'LIVE_ROOM_NOT_OPEN', 409);
      f.clock.set(at(-5 * MINUTE));
      await rejects(f.live.enter(a.id, r.id, { sizeId: '00000000-0000-4000-8000-000000000000' }, a.actor), 'LIVE_SIZE_UNKNOWN', 400);
      await rejects(f.live.enter(a.id, r.id, { sizeId: 'not-a-size' }, a.actor), 'LIVE_SIZE_UNKNOWN', 400);
      await rejects(f.live.enter(a.id, r.id, { sizeId: r.sizes[2]!.id }, a.actor), 'LIVE_SIZE_SOLD_OUT', 409);
      await rejects(f.live.enter(a.id, r.id, { sizeId: r.sizes[1]!.id, quantity: 3 }, a.actor), 'LIVE_QUANTITY_INVALID', 400);
      await rejects(f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id, quantity: 2 }, a.actor), 'LIVE_SIZE_SOLD_OUT', 409);
      const net = liveNetworkHash('p'.repeat(40), '203.0.113.7');
      const view = await f.live.enter(a.id, r.id, { sizeId: r.sizes[1]!.id, quantity: 2 }, a.actor, { networkHash: net, country: 'FR' });
      expect(view).toMatchObject({ status: 'WAITING', size: { id: r.sizes[1]!.id, label: '52' }, quantity: 2, tier: 1, position: null, turn: null, hold: null, priceMinor: 505_000, totalMinor: 1_010_000, currency: 'EUR' });
      const row = await entry(r.id, a.id);
      expect([row.network_hash, row.country, row.joined_at]).toEqual([net, 'FR', at(-5 * MINUTE)]);
      await rejects(f.live.enter(a.id, r.id, { sizeId: r.sizes[1]!.id }, a.actor), 'LIVE_ALREADY_ENTERED', 409);
      // A country or a hash of another shape is not kept.
      const b = await accountOfTier(f, 0);
      await f.live.enter(b.id, r.id, { sizeId: r.sizes[1]!.id }, b.actor, { networkHash: new Uint8Array(4), country: 'fr' });
      expect((await entry(r.id, b.id))).toMatchObject({ network_hash: null, country: null, tier: 0 });
      expect((await audits(r.id)).filter((x) => x.action === 'drop.live.enter').map((x) => x.details)).toEqual([
        { entryId: row.id, sizeId: r.sizes[1]!.id, quantity: 2 },
        { entryId: (await entry(r.id, b.id)).id, sizeId: r.sizes[1]!.id, quantity: 1 },
      ]);
    });

    it('changes its size until T0, never after; is left and entered again before T0, the same row', async () => {
      const r = await release({ sizes: [{ label: '50', stock: 1 }, { label: '52', stock: 1 }] });
      const a = await accountOfTier(f, 0);
      f.clock.set(at(-4 * MINUTE));
      const first = await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
      expect((await f.live.changeSize(a.id, r.id, { sizeId: r.sizes[1]!.id }, a.actor)).size.label).toBe('52');
      const left = await f.live.leave(a.id, r.id, a.actor);
      expect(left).toMatchObject({ status: 'LEFT', endedAt: at(-4 * MINUTE) });
      await rejects(f.live.changeSize(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor), 'LIVE_NOT_ENTERED', 409);
      await rejects(f.live.leave(a.id, r.id, a.actor), 'LIVE_NOT_IN_LINE', 409);
      f.clock.set(at(-1 * MINUTE));
      const again = await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
      expect(again).toMatchObject({ id: first.id, status: 'WAITING', endedAt: null, joinedAt: at(-1 * MINUTE) });
      await advance(r, T0);
      await rejects(f.live.changeSize(a.id, r.id, { sizeId: r.sizes[1]!.id }, a.actor), 'LIVE_SIZE_LOCKED', 409);
      expect((await entry(r.id, a.id)).size_id).toBe(r.sizes[0]!.id);
      // Left from the line, never back in it.
      await f.live.leave(a.id, r.id, a.actor);
      await rejects(f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor), 'LIVE_ALREADY_ENTERED', 409);
      expect((await audits(r.id)).map((x) => x.action)).toEqual([
        'drop.create', 'drop.live.enter', 'drop.live.size', 'drop.live.leave', 'drop.live.enter', 'drop.live.queue', 'drop.live.leave',
      ]);
    });

    it('takes I’LL BE THERE with a size from the announcement to T0, changed in place, withdrawn', async () => {
      const r = await release({ sizes: [{ label: '50', stock: 1 }, { label: '52', stock: 1 }] });
      const a = await accountOfTier(f, 0);
      f.clock.set('2026-11-01T10:00:00Z');
      const first = await f.live.setInterest(a.id, r.id, r.sizes[0]!.id, a.actor);
      expect(first).toEqual({ dropId: r.id, size: { id: r.sizes[0]!.id, label: '50' }, since: new Date('2026-11-01T10:00:00Z') });
      f.clock.advance(MINUTE);
      expect(await f.live.setInterest(a.id, r.id, r.sizes[1]!.id, a.actor)).toEqual({ ...first, size: { id: r.sizes[1]!.id, label: '52' } });
      expect(await f.live.interest(a.id, r.id)).toEqual({ ...first, size: { id: r.sizes[1]!.id, label: '52' } });
      await f.live.withdrawInterest(a.id, r.id, a.actor);
      expect(await f.live.interest(a.id, r.id)).toBeNull();
      await rejects(f.live.withdrawInterest(a.id, r.id, a.actor), 'LIVE_NOT_INTERESTED', 409);
      await f.live.setInterest(a.id, r.id, r.sizes[0]!.id, a.actor);
      f.clock.set(T0);
      await rejects(f.live.setInterest(a.id, r.id, r.sizes[1]!.id, a.actor), 'LIVE_INTEREST_CLOSED', 409);
      await rejects(f.live.withdrawInterest(a.id, r.id, a.actor), 'LIVE_INTEREST_CLOSED', 409);
      expect((await audits(r.id)).filter((x) => x.action.startsWith('drop.live.interest')).map((x) => [x.action, x.details])).toEqual([
        ['drop.live.interest', { sizeId: r.sizes[0]!.id }],
        ['drop.live.interest', { sizeId: r.sizes[1]!.id, before: r.sizes[0]!.id }],
        ['drop.live.interest.withdraw', { sizeId: r.sizes[1]!.id }],
        ['drop.live.interest', { sizeId: r.sizes[0]!.id }],
      ]);
    });

    it('refuses a locked account, a cancelled release and one that is over', async () => {
      const r = await release();
      const a = await accountOfTier(f, 0);
      f.clock.set(at(-MINUTE));
      await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', a.id).execute();
      await rejects(f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor), 'ACCOUNT_LOCKED', 403);
      const b = await accountOfTier(f, 0);
      f.clock.set(at(60 * MINUTE));
      await rejects(f.live.enter(b.id, r.id, { sizeId: r.sizes[0]!.id }, b.actor), 'LIVE_OVER', 409);
      await t.db.updateTable('drops').set({ cancelled_at: at(-2 * MINUTE) }).where('id', '=', r.id).execute();
      f.clock.set(at(-MINUTE));
      await rejects(f.live.enter(b.id, r.id, { sizeId: r.sizes[0]!.id }, b.actor), 'DROP_CANCELLED', 409);
      await rejects(f.live.pause(r.id, f.admin), 'DROP_CANCELLED', 409);
      // The engine leaves a cancelled release alone.
      expect(await advance(r, T0)).toBeNull();
    });

    it('is not a draw: the draw’s pages, entries and draw know nothing of it', async () => {
      const r = await release();
      const a = await accountOfTier(f, 2);
      f.clock.set(at(10 * MINUTE));
      expect((await f.drops.listPublic()).map((d) => d.id)).not.toContain(r.id);
      await rejects(f.drops.sheet(r.id), 'DROP_NOT_FOUND', 404);
      await rejects(f.drops.enter(a.id, r.id, a.actor), 'DROP_NOT_FOUND', 404);
      await rejects(f.drops.reserve(a.id, r.id, a.actor), 'DROP_NOT_FOUND', 404);
      f.clock.set(at(70 * MINUTE));
      await rejects(f.drops.draw(r.id, f.admin), 'DROP_LIVE', 409);
      await rejects(f.drops.offerNext(r.id, f.admin), 'DROP_LIVE', 409);
      // Nor do the draw's console paths: its list, a change, a publication or a cancellation.
      const draft = await release({ published: false });
      expect((await f.drops.list({ page: 1, pageSize: 200 })).items.map((d) => d.id)).not.toContain(r.id);
      for (const id of [r.id, draft.id]) {
        await rejects(f.drops.update(id, { description: 'A note.' }, f.admin), 'DROP_LIVE', 409);
        await rejects(f.drops.update(id, { quantity: 99 }, f.admin), 'DROP_LIVE', 409);
        await rejects(f.drops.publish(id, f.admin), 'DROP_LIVE', 409);
        await rejects(f.drops.cancel(id, f.admin), 'DROP_LIVE', 409);
      }
      expect(await t.db.selectFrom('drops').select(['published_at', 'cancelled_at', 'quantity']).where('id', '=', draft.id).executeTakeFirstOrThrow()).toEqual({ published_at: null, cancelled_at: null, quantity: 2 });
    });
  });

  describe('access', () => {
    it('by tier: below the release’s, refused with its rule; read again at SECURE', async () => {
      const r = await release({ minTier: 2 });
      const titane = await accountOfTier(f, 1);
      const platine = await accountOfTier(f, 2);
      f.clock.set(at(-MINUTE));
      const e = await rejects(f.live.enter(titane.id, r.id, { sizeId: r.sizes[0]!.id }, titane.actor), 'LIVE_NOT_ELIGIBLE', 403);
      expect(e.publicMessage).toBe('This release is for owners from PLATINE.');
      await rejects(f.live.setInterest(titane.id, r.id, r.sizes[0]!.id, titane.actor), 'LIVE_NOT_ELIGIBLE', 403);
      expect((await f.live.access(titane.id, r.id)).access).toEqual({ allowed: false, tier: 1, missing: 'TIER' });
      expect((await f.live.enter(platine.id, r.id, { sizeId: r.sizes[0]!.id }, platine.actor)).tier).toBe(2);
      await advance(r, T0);
      expect((await entry(r.id, platine.id)).status).toBe('TURN');
      // Two of its three pieces leave the account before it secures: TITANE now, the turn is refused.
      const held = await t.db.selectFrom('ownership').select('id').where('account_id', '=', platine.id).limit(2).execute();
      await t.db.updateTable('ownership').set({ ended_at: T0, ended_reason: 'TRANSFERRED_OUT' }).where('id', 'in', held.map((h) => h.id)).execute();
      await rejects(holdAndSecure(r.id, platine.id, platine.actor), 'LIVE_NOT_ELIGIBLE', 403);
      expect((await entry(r.id, platine.id)).status).toBe('TURN');
    });

    it('by the models held, or a collection (the piece’s own, else its model’s); an account holding neither is refused', async () => {
      const genesis = await createCollection(t.db, `GENESIS ${Date.now()}`);
      const orbit = await createModel(t.db, 'ORBIT');
      const halo = await createModel(t.db, 'HALO', genesis);
      const byModel = await release({ accessModels: [orbit] });
      const byCollection = await release({ accessCollectionId: genesis });
      const ownsOrbit = await createAccount(t.db);
      await holdPieces(t.db, ownsOrbit.id, 1, orbit);
      const ownsHalo = await createAccount(t.db);
      await holdPieces(t.db, ownsHalo.id, 1, halo);
      const ownsTagged = await createAccount(t.db);
      await holdPieces(t.db, ownsTagged.id, 1, f.modelId, { collectionId: genesis });
      const ownsOther = await accountOfTier(f, 3);
      f.clock.set(at(-MINUTE));
      const check = async (r: LiveRelease, a: { id: string }) => (await f.live.access(a.id, r.id)).access;
      expect(await check(byModel, ownsOrbit)).toEqual({ allowed: true, tier: 1, missing: null });
      expect(await check(byModel, ownsHalo)).toEqual({ allowed: false, tier: 1, missing: 'PIECE' });
      expect(await check(byModel, ownsOther)).toEqual({ allowed: false, tier: 3, missing: 'PIECE' });
      expect(await check(byCollection, ownsHalo)).toMatchObject({ allowed: true });
      expect(await check(byCollection, ownsTagged)).toMatchObject({ allowed: true });
      expect(await check(byCollection, ownsOrbit)).toMatchObject({ allowed: false, missing: 'PIECE' });
      const refusal = await rejects(f.live.enter(ownsHalo.id, byModel.id, { sizeId: byModel.sizes[0]!.id }, ownsHalo.actor), 'LIVE_NOT_ELIGIBLE', 403);
      expect(refusal.publicMessage).toBe('This release is for owners of ORBIT.');
      // A revoked piece counts for nothing, as in the club.
      const revoked = await createAccount(t.db);
      const [piece] = await holdPieces(t.db, revoked.id, 1, orbit);
      await t.db.updateTable('products').set({ status: 'REVOKED' }).where('id', '=', piece!).execute();
      const d = await t.db.selectFrom('drops').selectAll().where('id', '=', byModel.id).executeTakeFirstOrThrow();
      expect(await accessOf(t.db, d, revoked.id, at(-MINUTE))).toEqual({ allowed: false, tier: 0, missing: 'PIECE' });
    });
  });

  describe('T0 and the line', () => {
    it('places the room at T0 by tier read at T0, then by the seed; the late ones behind, by arrival', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 0 }, { label: '54', stock: 3 }] });
      const accounts = [await accountOfTier(f, 0), await accountOfTier(f, 1), await accountOfTier(f, 2), await accountOfTier(f, 2), await accountOfTier(f, 0), await accountOfTier(f, 1)];
      f.clock.set(at(-3 * MINUTE));
      for (const a of accounts) await f.live.enter(a.id, r.id, { sizeId: r.sizes[1]!.id }, a.actor);
      // The first one reaches PALLADIUM before T0: the line reads its tier at T0.
      await holdPieces(t.db, accounts[0]!.id, 5, f.modelId);
      expect((await entry(r.id, accounts[0]!.id)).tier).toBe(0);
      const report = await advance(r, at(100));
      expect(report).toMatchObject({ queued: 6, turns: 3 });
      const rows = await entriesOf(t.db, r.id);
      const d = await t.db.selectFrom('drops').selectAll().where('id', '=', r.id).executeTakeFirstOrThrow();
      const seed = openDropSeed(f.seedKey, d);
      const expected = lineOrder(rows.map((x) => ({ id: x.id, tier: x.tier })), seed, true).map((x) => x.id);
      expect(rows.map((x) => x.id)).toEqual(expected);
      expect(rows.map((x) => x.position)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(rows[0]!.account_id).toBe(accounts[0]!.id);
      expect(rows.map((x) => x.tier)).toEqual([...rows.map((x) => x.tier)].sort((a, b) => b - a));
      for (const x of rows) expect(x.queued_at).toEqual(T0);
      // The first three of the size take the three pieces at once.
      expect(rows.map((x) => x.status)).toEqual(['TURN', 'TURN', 'TURN', 'QUEUED', 'QUEUED', 'QUEUED']);
      expect((await audits(r.id)).find((x) => x.action === 'drop.live.queue')).toEqual({ action: 'drop.live.queue', actor: 'system', details: { entries: 6 } });
      // After T0: behind, in arrival order, straight into the line.
      const late = [await accountOfTier(f, 3), await accountOfTier(f, 0)];
      f.clock.set(at(10 * SECOND));
      const l1 = await f.live.enter(late[0]!.id, r.id, { sizeId: r.sizes[1]!.id }, late[0]!.actor);
      f.clock.set(at(11 * SECOND));
      const l2 = await f.live.enter(late[1]!.id, r.id, { sizeId: r.sizes[1]!.id }, late[1]!.actor);
      expect([l1.status, l1.position, l2.status, l2.position]).toEqual(['QUEUED', 7, 'QUEUED', 8]);
      expect((await entry(r.id, late[0]!.id)).queued_at).toEqual(at(10 * SECOND));
    });

    it('orders by the seed alone when the tier has no priority', async () => {
      const r = await release({ tierPriority: false, sizes: [{ label: '52', stock: 1 }] });
      f.clock.set(at(-MINUTE));
      for (const tier of [3, 0, 2, 1, 3, 0] as const) {
        const a = await accountOfTier(f, tier);
        await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
      }
      await advance(r, T0);
      const rows = await entriesOf(t.db, r.id);
      const seed = openDropSeed(f.seedKey, await t.db.selectFrom('drops').selectAll().where('id', '=', r.id).executeTakeFirstOrThrow());
      expect(rows.map((x) => x.id)).toEqual([...rows].sort((a, b) => (drawKey(seed, a.id) < drawKey(seed, b.id) ? -1 : 1)).map((x) => x.id));
    });

    it('refuses a late arrival in a size whose pieces are all confirmed', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 1 }, { label: '54', stock: 1 }] });
      const a = await accountOfTier(f, 0);
      f.clock.set(at(-MINUTE));
      await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
      await advance(r, T0);
      await holdAndSecure(r.id, a.id, a.actor);
      await f.live.confirm(a.id, r.id, a.actor);
      const b = await accountOfTier(f, 0);
      await rejects(f.live.enter(b.id, r.id, { sizeId: r.sizes[0]!.id }, b.actor), 'LIVE_SIZE_SOLD_OUT', 409);
      expect((await f.live.enter(b.id, r.id, { sizeId: r.sizes[1]!.id }, b.actor)).status).toBe('QUEUED');
    });
  });

  describe('turns, the seal and PAY', () => {
    it('secures only with the turn’s secret, a press 1.4 s earlier on the server’s clock and a running turn', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 1 }] });
      const a = await accountOfTier(f, 0);
      const b = await accountOfTier(f, 0);
      f.clock.set(at(-MINUTE));
      await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
      await f.live.enter(b.id, r.id, { sizeId: r.sizes[0]!.id }, b.actor);
      await advance(r, T0);
      const [first, second] = await entriesOf(t.db, r.id);
      const holder = first!.account_id === a.id ? a : b;
      const other = holder === a ? b : a;
      const view = (await f.live.entry(holder.id, r.id))!;
      expect(view.turn).toEqual({ at: T0, expiresAt: at(30 * SECOND), token: liveTurnToken(f.turnKey, first!.id, T0) });
      expect(first!.turn_token_hash).toEqual(turnTokenHash(view.turn!.token!));
      expect((await f.live.entry(other.id, r.id))!.turn).toBeNull();
      const token = view.turn!.token!;
      await rejects(f.live.press(other.id, r.id, token), 'LIVE_NOT_YOUR_TURN', 409);
      await rejects(f.live.press(holder.id, r.id, 'x'.repeat(43)), 'LIVE_TURN_CHANGED', 409);
      await rejects(f.live.secure(holder.id, r.id, token, holder.actor), 'LIVE_HOLD_TOO_SHORT', 409);
      f.clock.set(at(5 * SECOND));
      await f.live.press(holder.id, r.id, token);
      f.clock.set(at(5 * SECOND + LIVE_GESTURE_MIN_MS - 1));
      await rejects(f.live.secure(holder.id, r.id, token, holder.actor), 'LIVE_HOLD_TOO_SHORT', 409);
      // Letting go and pressing again restarts the ring.
      await f.live.press(holder.id, r.id, token);
      f.clock.advance(LIVE_GESTURE_MIN_MS - 1);
      await rejects(f.live.secure(holder.id, r.id, token, holder.actor), 'LIVE_HOLD_TOO_SHORT', 409);
      f.clock.advance(1);
      const secured = await f.live.secure(holder.id, r.id, token, holder.actor);
      const securedAt = f.clock.now();
      expect(secured).toMatchObject({ status: 'SECURED', hold: { securedAt, expiresAt: new Date(securedAt.getTime() + 5 * MINUTE) }, turn: { token: null } });
      expect((await entry(r.id, holder.id)).gesture_ms).toBe(LIVE_GESTURE_MIN_MS);
      await rejects(f.live.secure(holder.id, r.id, token, holder.actor), 'LIVE_NOT_YOUR_TURN', 409);
      expect(second!.status).toBe('QUEUED');
      expect((await audits(r.id)).find((x) => x.action === 'drop.live.secure')!.details).toEqual({ entryId: first!.id, gestureMs: LIVE_GESTURE_MIN_MS });
    });

    it('refuses a turn past its deadline at once, then the engine marks it MISSED at its deadline and gives the piece to the next', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 1 }] });
      const a = await accountOfTier(f, 3);
      const b = await accountOfTier(f, 0);
      f.clock.set(at(-MINUTE));
      await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
      await f.live.enter(b.id, r.id, { sizeId: r.sizes[0]!.id }, b.actor);
      await advance(r, T0);
      const token = await tokenOf(r.id, a.id);
      f.clock.set(at(29 * SECOND));
      await f.live.press(a.id, r.id, token);
      f.clock.set(at(30 * SECOND + 500));
      await rejects(f.live.secure(a.id, r.id, token, a.actor), 'LIVE_TURN_PASSED', 409);
      // Nor is it given back: a turn that has run out is MISSED, not LEFT.
      await rejects(f.live.leave(a.id, r.id, a.actor), 'LIVE_TURN_PASSED', 409);
      expect((await entry(r.id, a.id)).status).toBe('TURN');
      expect(await advance(r, at(31 * SECOND))).toMatchObject({ missed: 1, turns: 1 });
      expect(await entry(r.id, a.id)).toMatchObject({ status: 'MISSED', ended_at: at(30 * SECOND) });
      expect(await entry(r.id, b.id)).toMatchObject({ status: 'TURN', turn_at: at(31 * SECOND), turn_expires_at: at(61 * SECOND) });
    });

    it('serves each size by quantity: the head waits for its pieces, one that can never be served is passed over', async () => {
      const r = await release({ perAccount: 3, sizes: [{ label: '52', stock: 3 }] });
      const [a, b, c, d] = [await accountOfTier(f, 3), await accountOfTier(f, 2), await accountOfTier(f, 1), await accountOfTier(f, 0)];
      f.clock.set(at(-MINUTE));
      await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id, quantity: 2 }, a.actor);
      await f.live.enter(b.id, r.id, { sizeId: r.sizes[0]!.id, quantity: 2 }, b.actor);
      await f.live.enter(c.id, r.id, { sizeId: r.sizes[0]!.id, quantity: 3 }, c.actor);
      await f.live.enter(d.id, r.id, { sizeId: r.sizes[0]!.id, quantity: 1 }, d.actor);
      await advance(r, T0);
      // a takes 2 of 3; b (2) does not fit the one left and stops the size: c and d wait behind it.
      expect((await entriesOf(t.db, r.id)).map((x) => [x.account_id, x.status])).toEqual([[a.id, 'TURN'], [b.id, 'QUEUED'], [c.id, 'QUEUED'], [d.id, 'QUEUED']]);
      await holdAndSecure(r.id, a.id, a.actor);
      await f.live.confirm(a.id, r.id, a.actor);
      // One piece left that can ever be given: b (2) and c (3) can never be served; d takes it.
      await advance(r, at(10 * SECOND));
      expect((await entriesOf(t.db, r.id)).map((x) => x.status)).toEqual(['CONFIRMED', 'QUEUED', 'QUEUED', 'TURN']);
      // Pieces added serve b again, in its place.
      f.clock.set(at(20 * SECOND));
      await f.live.addPieces(r.id, r.sizes[0]!.id, 2, f.admin);
      expect((await entriesOf(t.db, r.id)).map((x) => x.status)).toEqual(['CONFIRMED', 'TURN', 'QUEUED', 'TURN']);
    });

    it('applies the windows of the entry’s tier to its turn and its hold', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 2 }], windows: [{ tier: 3, turnSeconds: 60, payMinutes: 10 }, { tier: 0, payMinutes: 2 }] });
      const palladium = await accountOfTier(f, 3);
      const none = await accountOfTier(f, 0);
      f.clock.set(at(-MINUTE));
      await f.live.enter(palladium.id, r.id, { sizeId: r.sizes[0]!.id }, palladium.actor);
      await f.live.enter(none.id, r.id, { sizeId: r.sizes[0]!.id }, none.actor);
      await advance(r, T0);
      expect((await entry(r.id, palladium.id)).turn_expires_at).toEqual(at(60 * SECOND));
      expect((await entry(r.id, none.id)).turn_expires_at).toEqual(at(30 * SECOND));
      f.clock.set(at(SECOND));
      const p = await holdAndSecure(r.id, palladium.id, palladium.actor);
      expect(p.hold!.expiresAt).toEqual(new Date(p.hold!.securedAt.getTime() + 10 * MINUTE));
      f.clock.set(at(5 * SECOND));
      const n = await holdAndSecure(r.id, none.id, none.actor);
      expect(n.hold!.expiresAt).toEqual(new Date(n.hold!.securedAt.getTime() + 2 * MINUTE));
    });

    it('takes add-ons for a held piece, the total on the price per piece; PAY confirms; the hold ends with its add-ons', async () => {
      const r = await release({
        perAccount: 2,
        sizes: [{ label: '52', stock: 3 }],
        addons: [{ label: 'ENGRAVING', priceMinor: 15_000 }, { label: 'GIFT BOX', priceMinor: 5_000 }, { label: 'ORBES CARE', priceMinor: 24_000 }],
      });
      const other = await release({ addons: [{ label: 'X', priceMinor: 1 }] });
      const [a, b] = [await accountOfTier(f, 1), await accountOfTier(f, 0)];
      f.clock.set(at(-MINUTE));
      await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id, quantity: 2 }, a.actor);
      await f.live.enter(b.id, r.id, { sizeId: r.sizes[0]!.id }, b.actor);
      await advance(r, T0);
      await rejects(f.live.setAddons(a.id, r.id, [r.addons[0]!.id], a.actor), 'LIVE_NOT_SECURED', 409);
      await holdAndSecure(r.id, a.id, a.actor);
      await rejects(f.live.setAddons(a.id, r.id, ['00000000-0000-4000-8000-000000000000'], a.actor), 'LIVE_ADDON_UNKNOWN', 400);
      await rejects(f.live.setAddons(a.id, r.id, [other.addons[0]!.id], a.actor), 'LIVE_ADDON_UNKNOWN', 400);
      f.clock.set(at(10 * SECOND));
      const chosen = await f.live.setAddons(a.id, r.id, [r.addons[1]!.id, r.addons[0]!.id, r.addons[0]!.id], a.actor);
      expect(chosen.addons).toEqual([
        { id: r.addons[0]!.id, label: 'ENGRAVING', priceMinor: 15_000 },
        { id: r.addons[1]!.id, label: 'GIFT BOX', priceMinor: 5_000 },
      ]);
      expect(chosen.totalMinor).toBe(2 * (505_000 + 15_000 + 5_000));
      // The price is the one at the time of the choice.
      await t.db.updateTable('live_addons').set({ price_minor: 99_000 }).where('id', '=', r.addons[0]!.id).execute();
      expect((await f.live.entry(a.id, r.id))!.totalMinor).toBe(2 * (505_000 + 15_000 + 5_000));
      expect((await f.live.setAddons(a.id, r.id, [], a.actor)).addons).toEqual([]);
      await f.live.setAddons(a.id, r.id, [r.addons[2]!.id], a.actor);
      const confirmed = await f.live.confirm(a.id, r.id, a.actor);
      expect(confirmed).toMatchObject({ status: 'CONFIRMED', confirmedAt: at(10 * SECOND), totalMinor: 2 * (505_000 + 24_000) });
      await rejects(f.live.confirm(a.id, r.id, a.actor), 'LIVE_NOT_SECURED', 409);
      await rejects(f.live.release(a.id, r.id, a.actor), 'LIVE_NOT_SECURED', 409);
      // b's hold runs out: its add-ons go with it, its piece returns.
      f.clock.set(at(11 * SECOND));
      await holdAndSecure(r.id, b.id, b.actor);
      await f.live.setAddons(b.id, r.id, [r.addons[1]!.id], b.actor);
      const end = (await entry(r.id, b.id)).hold_expires_at!;
      f.clock.set(end);
      await rejects(f.live.confirm(b.id, r.id, b.actor), 'LIVE_HOLD_ENDED', 409);
      await rejects(f.live.setAddons(b.id, r.id, [], b.actor), 'LIVE_HOLD_ENDED', 409);
      expect(await advance(r, end)).toMatchObject({ expired: 1 });
      expect(await entry(r.id, b.id)).toMatchObject({ status: 'EXPIRED', ended_at: end });
      expect(await t.db.selectFrom('live_entry_addons').select('addon_id').where('entry_id', '=', (await entry(r.id, b.id)).id).execute()).toEqual([]);
    });

    it('gives the piece back on RELEASE MY PLACE, on a LEAVE during a turn, a freed hold and a removal: the next in line at once', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 1 }] });
      const people = [await accountOfTier(f, 3), await accountOfTier(f, 2), await accountOfTier(f, 1), await accountOfTier(f, 0), await accountOfTier(f, 0)];
      f.clock.set(at(-MINUTE));
      for (const p of people) await f.live.enter(p.id, r.id, { sizeId: r.sizes[0]!.id }, p.actor);
      await advance(r, T0);
      const line = (await entriesOf(t.db, r.id)).map((x) => x.account_id);
      const who = (i: number) => people.find((p) => p.id === line[i])!;
      const statuses = async () => (await entriesOf(t.db, r.id)).map((x) => x.status);
      f.clock.set(at(SECOND));
      await holdAndSecure(r.id, who(0).id, who(0).actor);
      await f.live.release(who(0).id, r.id, who(0).actor);
      expect(await statuses()).toEqual(['RELEASED', 'TURN', 'QUEUED', 'QUEUED', 'QUEUED']);
      await f.live.leave(who(1).id, r.id, who(1).actor);
      expect(await statuses()).toEqual(['RELEASED', 'LEFT', 'TURN', 'QUEUED', 'QUEUED']);
      await holdAndSecure(r.id, who(2).id, who(2).actor);
      const freed = await f.live.freeHold(r.id, (await entry(r.id, who(2).id)).id, f.admin);
      expect(freed).toMatchObject({ status: 'EXPIRED', email: who(2).email });
      expect(await statuses()).toEqual(['RELEASED', 'LEFT', 'EXPIRED', 'TURN', 'QUEUED']);
      await rejects(f.live.freeHold(r.id, (await entry(r.id, who(3).id)).id, f.admin), 'LIVE_ENTRY_NOT_SECURED', 409);
      const removed = await f.live.remove(r.id, (await entry(r.id, who(3).id)).id, f.admin);
      expect(removed).toMatchObject({ status: 'REMOVED', endedAt: f.clock.now() });
      expect(await entry(r.id, who(3).id)).toMatchObject({ removed_by: f.admin.id, removed_at: f.clock.now() });
      expect(await statuses()).toEqual(['RELEASED', 'LEFT', 'EXPIRED', 'REMOVED', 'TURN']);
      await rejects(f.live.remove(r.id, (await entry(r.id, who(3).id)).id, f.admin), 'LIVE_ENTRY_CLOSED', 409);
      expect((await audits(r.id)).filter((x) => x.actor === 'admin' && x.action.startsWith('drop.live.')).map((x) => [x.action, x.details])).toEqual([
        ['drop.live.free', { entryId: (await entry(r.id, who(2).id)).id }],
        ['drop.live.remove', { entryId: (await entry(r.id, who(3).id)).id, from: 'TURN' }],
      ]);
    });

    it('ends a hold freed after its deadline (not yet marked by the engine) at that deadline', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 1 }] });
      const [a, b] = [await accountOfTier(f, 3), await accountOfTier(f, 0)];
      f.clock.set(at(-MINUTE));
      for (const p of [a, b]) await f.live.enter(p.id, r.id, { sizeId: r.sizes[0]!.id }, p.actor);
      await advance(r, T0);
      f.clock.set(at(SECOND));
      await holdAndSecure(r.id, a.id, a.actor);
      const holdEnd = (await entry(r.id, a.id)).hold_expires_at!;
      f.clock.set(new Date(holdEnd.getTime() + 10 * SECOND));
      expect(await f.live.freeHold(r.id, (await entry(r.id, a.id)).id, f.admin)).toMatchObject({ status: 'EXPIRED', endedAt: holdEnd });
      expect(await entry(r.id, b.id)).toMatchObject({ status: 'TURN', turn_at: f.clock.now() });
    });
  });

  describe('the console’s controls', () => {
    it('PAUSE: no turn, no press nor secure, the deadlines frozen; RESUME moves them by the pause; a hold may be confirmed meanwhile', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 2 }] });
      const [a, b, c] = [await accountOfTier(f, 3), await accountOfTier(f, 2), await accountOfTier(f, 0)];
      f.clock.set(at(-MINUTE));
      for (const p of [a, b, c]) await f.live.enter(p.id, r.id, { sizeId: r.sizes[0]!.id }, p.actor);
      f.clock.set(at(-SECOND));
      await rejects(f.live.pause(r.id, f.admin), 'LIVE_NOT_STARTED', 409);
      await advance(r, T0);
      f.clock.set(at(10 * SECOND));
      await holdAndSecure(r.id, a.id, a.actor);
      const holdEnd = (await entry(r.id, a.id)).hold_expires_at!;
      const tokenB = await tokenOf(r.id, b.id);
      f.clock.set(at(12 * SECOND));
      const paused = await f.live.pause(r.id, f.admin);
      expect(paused).toMatchObject({ pausedAt: at(12 * SECOND), pausedMs: 0 });
      await rejects(f.live.pause(r.id, f.admin), 'LIVE_ALREADY_PAUSED', 409);
      // Ten minutes paused: b's turn (30 s from T0) and a's hold are not consumed; no new turn, no press.
      f.clock.set(at(10 * MINUTE));
      expect(await advance(r, at(10 * MINUTE))).toMatchObject({ missed: 0, expired: 0, turns: 0 });
      await rejects(f.live.press(b.id, r.id, tokenB), 'LIVE_PAUSED', 409);
      expect((await f.live.entry(b.id, r.id))!.turn!.expiresAt).toEqual(new Date(at(30 * SECOND).getTime() + (10 * MINUTE - 12 * SECOND)));
      await f.live.release(a.id, r.id, a.actor);
      expect((await entriesOf(t.db, r.id)).map((x) => x.status)).toEqual(['RELEASED', 'TURN', 'QUEUED']);
      await rejects(f.live.letIn(r.id, (await entry(r.id, c.id)).id, f.admin), 'LIVE_PAUSED', 409);
      const resumed = await f.live.resume(r.id, f.admin);
      const pausedMs = 10 * MINUTE - 12 * SECOND;
      expect(resumed).toMatchObject({ pausedAt: null, pausedMs });
      await rejects(f.live.resume(r.id, f.admin), 'LIVE_NOT_PAUSED', 409);
      // b keeps the 18 s it had; the piece a gave back goes to c at once.
      expect((await entry(r.id, b.id)).turn_expires_at).toEqual(new Date(at(30 * SECOND).getTime() + pausedMs));
      expect(await entry(r.id, c.id)).toMatchObject({ status: 'TURN', turn_at: at(10 * MINUTE) });
      expect(holdEnd.getTime()).toBeGreaterThan(at(12 * SECOND).getTime());
      expect((await audits(r.id)).filter((x) => x.action === 'drop.live.resume').map((x) => x.details)).toEqual([{ pausedMs }]);
    });

    it('EXTEND moves the close; ADD PIECES raises a size and the quantity, audited with the line the announcement promised', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 1 }, { label: '54', stock: 1 }], quantityLine: '2 PIECES · NEVER MORE' });
      const [a, b] = [await accountOfTier(f, 0), await accountOfTier(f, 0)];
      f.clock.set(at(-MINUTE));
      await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
      await f.live.enter(b.id, r.id, { sizeId: r.sizes[0]!.id }, b.actor);
      await advance(r, T0);
      await rejects(f.live.extend(r.id, 0, f.admin), 'VALIDATION_FAILED', 400);
      await rejects(f.live.extend(r.id, 241, f.admin), 'VALIDATION_FAILED', 400);
      expect((await f.live.extend(r.id, 30, f.admin)).closesAt).toEqual(at(90 * MINUTE));
      await rejects(f.live.addPieces(r.id, r.sizes[0]!.id, 0, f.admin), 'VALIDATION_FAILED', 400);
      await rejects(f.live.addPieces(r.id, '00000000-0000-4000-8000-000000000000', 1, f.admin), 'LIVE_SIZE_UNKNOWN', 400);
      const state = await f.live.addPieces(r.id, r.sizes[0]!.id, 3, f.admin);
      expect(state).toMatchObject({ quantity: 5, quantityLine: '2 PIECES · NEVER MORE', sizes: [{ label: '52', stock: 4 }, { label: '54', stock: 1 }] });
      expect((await t.db.selectFrom('drops').select('quantity').where('id', '=', r.id).executeTakeFirstOrThrow()).quantity).toBe(5);
      expect([(await entry(r.id, a.id)).status, (await entry(r.id, b.id)).status]).toEqual(['TURN', 'TURN']);
      expect((await audits(r.id)).filter((x) => x.action === 'drop.live.stock' || x.action === 'drop.live.extend').map((x) => [x.action, x.details])).toEqual([
        ['drop.live.extend', { minutes: 30, before: at(60 * MINUTE).toISOString(), after: at(90 * MINUTE).toISOString() }],
        ['drop.live.stock', { sizeId: r.sizes[0]!.id, size: '52', pieces: 3, before: 1, after: 4, quantity: 5, quantityLine: '2 PIECES · NEVER MORE' }],
      ]);
    });

    it('LET IN gives a turn out of order within the free pieces (a line stalled by a quantity); a host message is one line', async () => {
      const r = await release({ perAccount: 2, sizes: [{ label: '52', stock: 2 }] });
      const [a, b, c] = [await accountOfTier(f, 3), await accountOfTier(f, 2), await accountOfTier(f, 0)];
      f.clock.set(at(-MINUTE));
      await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
      await f.live.enter(b.id, r.id, { sizeId: r.sizes[0]!.id, quantity: 2 }, b.actor);
      await f.live.enter(c.id, r.id, { sizeId: r.sizes[0]!.id }, c.actor);
      await rejects(f.live.letIn(r.id, (await entry(r.id, c.id)).id, f.admin), 'LIVE_NOT_STARTED', 409);
      await advance(r, T0);
      // a holds one piece; b, next, wants two: the line stalls with one piece free.
      expect((await entriesOf(t.db, r.id)).map((x) => [x.account_id, x.status])).toEqual([[a.id, 'TURN'], [b.id, 'QUEUED'], [c.id, 'QUEUED']]);
      await rejects(f.live.letIn(r.id, (await entry(r.id, b.id)).id, f.admin), 'LIVE_NO_FREE_PIECE', 409);
      await rejects(f.live.letIn(r.id, (await entry(r.id, a.id)).id, f.admin), 'LIVE_ENTRY_NOT_QUEUED', 409);
      await rejects(f.live.letIn(r.id, '00000000-0000-4000-8000-000000000000', f.admin), 'LIVE_ENTRY_NOT_FOUND', 404);
      f.clock.set(at(5 * SECOND));
      const letIn = await f.live.letIn(r.id, (await entry(r.id, c.id)).id, f.admin);
      expect(letIn).toMatchObject({ status: 'TURN', letIn: true, turnAt: at(5 * SECOND), turnExpiresAt: at(35 * SECOND), position: 3 });
      expect(await entry(r.id, c.id)).toMatchObject({ let_in_by: f.admin.id });
      expect((await f.live.entry(c.id, r.id))!.letIn).toBe(true);
      expect((await entry(r.id, b.id)).status).toBe('QUEUED');
      expect((await audits(r.id)).filter((x) => x.action === 'drop.live.let_in').map((x) => x.details)).toEqual([{ entryId: (await entry(r.id, c.id)).id, position: 3 }]);

      await rejects(f.live.message(r.id, '   ', f.admin), 'VALIDATION_FAILED', 400);
      await rejects(f.live.message(r.id, 'x'.repeat(141), f.admin), 'VALIDATION_FAILED', 400);
      await rejects(f.live.message(r.id, 'two\nlines', f.admin), 'VALIDATION_FAILED', 400);
      await rejects(f.live.message(r.id, 'Hello', a.actor), 'FORBIDDEN', 403);
      const m = await f.live.message(r.id, '  The atelier thanks you for waiting.  ', f.admin);
      expect(m).toEqual({ id: expect.any(String), text: 'The atelier thanks you for waiting.', createdAt: at(5 * SECOND) });
      expect((await audits(r.id)).filter((x) => x.action === 'drop.live.message').map((x) => x.details)).toEqual([{ messageId: m.id, text: 'The atelier thanks you for waiting.' }]);
      await expect(sql`UPDATE live_messages SET text = 'x' WHERE id = ${m.id}`.execute(t.db)).rejects.toThrow(/never changes/);
    });
  });

  describe('the end', () => {
    it('SOLD_OUT: the last piece confirmed ends the release at once, the room and the line ENDED', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 1 }, { label: '54', stock: 1 }] });
      const [a, b, c] = [await accountOfTier(f, 3), await accountOfTier(f, 2), await accountOfTier(f, 0)];
      f.clock.set(at(-MINUTE));
      await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
      await f.live.enter(b.id, r.id, { sizeId: r.sizes[1]!.id }, b.actor);
      await f.live.enter(c.id, r.id, { sizeId: r.sizes[0]!.id }, c.actor);
      await advance(r, T0);
      for (const p of [a, b]) {
        await holdAndSecure(r.id, p.id, p.actor);
        await f.live.confirm(p.id, r.id, p.actor);
      }
      const last = (await entry(r.id, b.id)).confirmed_at!;
      expect(await t.db.selectFrom('drops').select(['ended_at', 'ended_reason']).where('id', '=', r.id).executeTakeFirstOrThrow()).toEqual({ ended_at: last, ended_reason: 'SOLD_OUT' });
      expect(await entry(r.id, c.id)).toMatchObject({ status: 'ENDED', ended_at: last });
      expect((await audits(r.id)).filter((x) => x.action === 'drop.live.end')).toEqual([{ action: 'drop.live.end', actor: 'system', details: { reason: 'SOLD_OUT', at: last.toISOString(), ended: 1 } }]);
      await rejects(f.live.addPieces(r.id, r.sizes[0]!.id, 1, f.admin), 'LIVE_ENDED', 409);
      await rejects(f.live.extend(r.id, 5, f.admin), 'LIVE_ENDED', 409);
      const late = await accountOfTier(f, 0);
      await rejects(f.live.enter(late.id, r.id, { sizeId: r.sizes[0]!.id }, late.actor), 'LIVE_OVER', 409);
      expect(await f.live.liveReleaseIds()).not.toContain(r.id);
    });

    it('CLOSED at closes_at: no new turn, the line ENDED; a turn may still be secured and a hold confirmed until their deadlines; then over', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 3 }], closesAt: at(MINUTE), turnSeconds: 90 });
      const people = [await accountOfTier(f, 3), await accountOfTier(f, 2), await accountOfTier(f, 1), await accountOfTier(f, 0)];
      f.clock.set(at(-MINUTE));
      for (const p of people) await f.live.enter(p.id, r.id, { sizeId: r.sizes[0]!.id }, p.actor);
      await advance(r, T0);
      const line = (await entriesOf(t.db, r.id)).map((x) => people.find((p) => p.id === x.account_id)!);
      // Three turns of 90 s from T0; the close at 60 s.
      f.clock.set(at(10 * SECOND));
      await holdAndSecure(r.id, line[0]!.id, line[0]!.actor);
      expect(await advance(r, at(MINUTE + 100))).toMatchObject({ ended: 'CLOSED', turns: 0 });
      expect(await t.db.selectFrom('drops').select(['ended_at', 'ended_reason']).where('id', '=', r.id).executeTakeFirstOrThrow()).toEqual({ ended_at: at(MINUTE), ended_reason: 'CLOSED' });
      expect((await entriesOf(t.db, r.id)).map((x) => [x.status, x.ended_at])).toEqual([
        ['SECURED', null],
        ['TURN', null],
        ['TURN', null],
        ['ENDED', at(MINUTE)],
      ]);
      expect((await audits(r.id)).filter((x) => x.action === 'drop.live.end')).toEqual([{ action: 'drop.live.end', actor: 'system', details: { reason: 'CLOSED', at: at(MINUTE).toISOString(), ended: 1 } }]);
      const late = await accountOfTier(f, 0);
      await rejects(f.live.enter(late.id, r.id, { sizeId: r.sizes[0]!.id }, late.actor), 'LIVE_OVER', 409);
      // After the close: a turn in progress is secured, a hold confirmed; a turn that runs out is MISSED, no new turn.
      f.clock.set(at(70 * SECOND));
      await holdAndSecure(r.id, line[2]!.id, line[2]!.actor);
      await f.live.confirm(line[2]!.id, r.id, line[2]!.actor);
      await f.live.confirm(line[0]!.id, r.id, line[0]!.actor);
      expect(await f.live.liveReleaseIds()).toContain(r.id);
      expect(await advance(r, at(91 * SECOND))).toMatchObject({ missed: 1, turns: 0, ended: null });
      expect((await entriesOf(t.db, r.id)).map((x) => x.status)).toEqual(['CONFIRMED', 'MISSED', 'CONFIRMED', 'ENDED']);
      expect((await t.db.selectFrom('drops').select('ended_reason').where('id', '=', r.id).executeTakeFirstOrThrow()).ended_reason).toBe('CLOSED');
      expect(await f.live.liveReleaseIds()).not.toContain(r.id);
      await rejects(f.live.end(r.id, f.admin), 'LIVE_ENDED', 409);
    });

    it('CLOSED during a pause: the pause ends with it, the turns and holds moved by it; SECURE until the moved deadline, MISSED at it; then over', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 3 }], closesAt: at(MINUTE) });
      const people = [await accountOfTier(f, 3), await accountOfTier(f, 2), await accountOfTier(f, 1), await accountOfTier(f, 0)];
      f.clock.set(at(-MINUTE));
      for (const p of people) await f.live.enter(p.id, r.id, { sizeId: r.sizes[0]!.id }, p.actor);
      await advance(r, T0);
      const [a, b, c, d] = (await entriesOf(t.db, r.id)).map((x) => people.find((p) => p.id === x.account_id)!);
      // Three turns of 30 s from T0; a secures; paused at 10 s; the close at 60 s passes during the pause.
      f.clock.set(at(5 * SECOND));
      await holdAndSecure(r.id, a!.id, a!.actor);
      const holdEnd = (await entry(r.id, a!.id)).hold_expires_at!;
      f.clock.set(at(10 * SECOND));
      await f.live.pause(r.id, f.admin);
      const pausedMs = 61 * SECOND - 10 * SECOND;
      expect(await advance(r, at(61 * SECOND))).toMatchObject({ ended: 'CLOSED', missed: 0, turns: 0 });
      expect(await t.db.selectFrom('drops').select(['ended_at', 'ended_reason', 'paused_at', 'paused_ms_total']).where('id', '=', r.id).executeTakeFirstOrThrow()).toEqual({
        ended_at: at(MINUTE),
        ended_reason: 'CLOSED',
        paused_at: null,
        paused_ms_total: pausedMs,
      });
      expect((await entriesOf(t.db, r.id)).map((x) => [x.status, x.turn_expires_at, x.hold_expires_at, x.ended_at])).toEqual([
        ['SECURED', at(30 * SECOND), new Date(holdEnd.getTime() + pausedMs), null],
        ['TURN', at(30 * SECOND + pausedMs), null, null],
        ['TURN', at(30 * SECOND + pausedMs), null, null],
        ['ENDED', null, null, at(MINUTE)],
      ]);
      expect((await audits(r.id)).filter((x) => x.action === 'drop.live.end')).toEqual([
        { action: 'drop.live.end', actor: 'system', details: { reason: 'CLOSED', at: at(MINUTE).toISOString(), ended: 1, pausedMs } },
      ]);
      await rejects(f.live.pause(r.id, f.admin), 'LIVE_ENDED', 409);
      await rejects(f.live.resume(r.id, f.admin), 'LIVE_NOT_PAUSED', 409);
      // b secures just before its moved deadline; c's turn runs out at it and is MISSED there.
      f.clock.set(at(30 * SECOND + pausedMs - 2 * SECOND));
      expect(await holdAndSecure(r.id, b!.id, b!.actor)).toMatchObject({ status: 'SECURED' });
      expect(await advance(r, at(30 * SECOND + pausedMs + SECOND))).toMatchObject({ missed: 1, turns: 0, ended: null });
      expect(await entry(r.id, c!.id)).toMatchObject({ status: 'MISSED', ended_at: at(30 * SECOND + pausedMs) });
      for (const p of [a!, b!]) await f.live.confirm(p.id, r.id, p.actor);
      expect((await entriesOf(t.db, r.id)).map((x) => x.status)).toEqual(['CONFIRMED', 'CONFIRMED', 'MISSED', 'ENDED']);
      expect(await entry(r.id, d!.id)).toMatchObject({ status: 'ENDED' });
      expect(await f.live.liveReleaseIds()).not.toContain(r.id);
    });

    it('SOLD_OUT during a pause: the last piece confirmed ends the pause with the release', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 1 }] });
      const [a, b] = [await accountOfTier(f, 3), await accountOfTier(f, 0)];
      f.clock.set(at(-MINUTE));
      for (const p of [a, b]) await f.live.enter(p.id, r.id, { sizeId: r.sizes[0]!.id }, p.actor);
      await advance(r, T0);
      f.clock.set(at(5 * SECOND));
      await holdAndSecure(r.id, a.id, a.actor);
      f.clock.set(at(10 * SECOND));
      await f.live.pause(r.id, f.admin);
      f.clock.set(at(40 * SECOND));
      await f.live.confirm(a.id, r.id, a.actor);
      expect(await t.db.selectFrom('drops').select(['ended_at', 'ended_reason', 'paused_at', 'paused_ms_total']).where('id', '=', r.id).executeTakeFirstOrThrow()).toEqual({
        ended_at: at(40 * SECOND),
        ended_reason: 'SOLD_OUT',
        paused_at: null,
        paused_ms_total: 30 * SECOND,
      });
      expect(await entry(r.id, b.id)).toMatchObject({ status: 'ENDED', ended_at: at(40 * SECOND) });
      expect((await audits(r.id)).filter((x) => x.action === 'drop.live.end').map((x) => x.details)).toEqual([{ reason: 'SOLD_OUT', at: at(40 * SECOND).toISOString(), ended: 1, pausedMs: 30 * SECOND }]);
      expect(await f.live.liveReleaseIds()).not.toContain(r.id);
    });

    it('ENDED by an ADMIN: the room, the line and the turns ENDED at once; a hold may still be confirmed; a pause ends with it', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 2 }] });
      const people = [await accountOfTier(f, 3), await accountOfTier(f, 2), await accountOfTier(f, 1)];
      f.clock.set(at(-MINUTE));
      for (const p of people) await f.live.enter(p.id, r.id, { sizeId: r.sizes[0]!.id }, p.actor);
      await advance(r, T0);
      const line = (await entriesOf(t.db, r.id)).map((x) => people.find((p) => p.id === x.account_id)!);
      f.clock.set(at(5 * SECOND));
      await holdAndSecure(r.id, line[0]!.id, line[0]!.actor);
      const holdEnd = (await entry(r.id, line[0]!.id)).hold_expires_at!;
      f.clock.set(at(10 * SECOND));
      await f.live.pause(r.id, f.admin);
      f.clock.set(at(70 * SECOND));
      const ended = await f.live.end(r.id, f.admin);
      expect(ended).toMatchObject({ endedAt: at(70 * SECOND), endedReason: 'ENDED', pausedAt: null, pausedMs: 60 * SECOND });
      expect((await entriesOf(t.db, r.id)).map((x) => x.status)).toEqual(['SECURED', 'ENDED', 'ENDED']);
      expect((await entry(r.id, line[0]!.id)).hold_expires_at).toEqual(new Date(holdEnd.getTime() + 60 * SECOND));
      expect((await audits(r.id)).filter((x) => x.action === 'drop.live.end')).toEqual([
        { action: 'drop.live.end', actor: 'admin', details: { reason: 'ENDED', at: at(70 * SECOND).toISOString(), ended: 2, pausedMs: 60 * SECOND } },
      ]);
      await f.live.confirm(line[0]!.id, r.id, line[0]!.actor);
      expect((await t.db.selectFrom('drops').select('ended_reason').where('id', '=', r.id).executeTakeFirstOrThrow()).ended_reason).toBe('ENDED');
      expect(await f.live.liveReleaseIds()).not.toContain(r.id);
      await rejects(f.live.end(r.id, f.admin), 'LIVE_ENDED', 409);
    });

    it('ENDED before T0: the room ENDED, the release never opens', async () => {
      const r = await release();
      const a = await accountOfTier(f, 0);
      f.clock.set(at(-MINUTE));
      await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor);
      await f.live.end(r.id, f.admin);
      expect(await entry(r.id, a.id)).toMatchObject({ status: 'ENDED', ended_at: at(-MINUTE) });
      expect(await advance(r, T0)).toMatchObject({ queued: 0, turns: 0, ended: null });
    });
  });

  describe('the account', () => {
    it('a lock removes its open entries (a confirmed one stays) and withdraws its interest in releases not opened yet; the export lists them', async () => {
      const sessions = new SessionService({ db: t.db, clock: f.clock.now, ttlHours: { account: 24, admin: 8 } });
      const lifecycle = new LifecycleService({ db: t.db, audit: f.audit, clock: f.clock.now });
      const ownership = new OwnershipService({ db: t.db, audit: f.audit, lifecycle, clock: f.clock.now, transferKey: new Uint8Array(32).fill(9), requireScannedPiece: false });
      const owners = new OwnerService({ db: t.db, audit: f.audit, sessions, ownership, clock: f.clock.now });
      const past = await release({ sizes: [{ label: '52', stock: 2 }], addons: [{ label: 'GIFT BOX', priceMinor: 5_000 }] });
      const later = await createLiveRelease(f, { opensAt: new Date('2026-12-01T10:00:00Z'), sizes: [{ label: '50', stock: 1 }] });
      const a = await accountOfTier(f, 1);
      const b = await accountOfTier(f, 0);
      f.clock.set('2026-11-01T12:00:00Z');
      await f.live.setInterest(a.id, past.id, past.sizes[0]!.id, a.actor);
      await f.live.setInterest(a.id, later.id, later.sizes[0]!.id, a.actor);
      f.clock.set(at(-MINUTE));
      await f.live.enter(a.id, past.id, { sizeId: past.sizes[0]!.id }, a.actor, { country: 'FR', networkHash: new Uint8Array(32).fill(1) });
      await f.live.enter(b.id, past.id, { sizeId: past.sizes[0]!.id }, b.actor);
      await advance(past, T0);
      f.clock.set(at(5 * SECOND));
      await holdAndSecure(past.id, a.id, a.actor);
      await f.live.setAddons(a.id, past.id, [past.addons[0]!.id], a.actor);
      await holdAndSecure(past.id, b.id, b.actor);
      await f.live.confirm(b.id, past.id, b.actor);
      f.clock.set(at(20 * SECOND));
      const out = await owners.lock(a.id, f.admin);
      expect(out).toMatchObject({ liveEntriesRemoved: 1, liveInterestWithdrawn: 1 });
      expect(await entry(past.id, a.id)).toMatchObject({ status: 'REMOVED', removed_by: f.admin.id, removed_at: at(20 * SECOND), ended_at: at(20 * SECOND) });
      expect(await t.db.selectFrom('live_entry_addons').selectAll().where('entry_id', '=', (await entry(past.id, a.id)).id).execute()).toEqual([]);
      // Its interest in the release already open stays (the release's history); the later one is withdrawn.
      expect((await t.db.selectFrom('live_interest').select('drop_id').where('account_id', '=', a.id).execute()).map((x) => x.drop_id)).toEqual([past.id]);
      const lockAudits = await t.db.selectFrom('audit_logs').select(['action', 'target_id', 'details']).where('action', 'in', ['drop.live.remove', 'drop.live.interest.withdraw', 'account.lock']).where('actor_id', '=', f.admin.id).orderBy('id').execute();
      expect(lockAudits.slice(-3).map((x) => [x.action, x.target_id, x.details])).toEqual([
        ['drop.live.remove', past.id, { entryId: (await entry(past.id, a.id)).id, from: 'SECURED', reason: 'account_locked' }],
        ['drop.live.interest.withdraw', later.id, { reason: 'account_locked' }],
        ['account.lock', a.id, expect.objectContaining({ liveEntriesRemoved: 1, liveInterestWithdrawn: 1 })],
      ]);
      // b's confirmed reservation is not touched by anything; its export lists it with its add-ons (none) and country.
      const xa = await owners.exportData(a.id, f.admin);
      expect(xa.liveEntries).toEqual([
        expect.objectContaining({ dropId: past.id, title: 'LIVE', size: '52', quantity: 1, status: 'REMOVED', country: 'FR', currency: 'EUR', priceMinor: 505_000, addons: [], gestureMs: 1500, letIn: false }),
      ]);
      expect(xa.liveInterest).toEqual([{ dropId: past.id, title: 'LIVE', size: '52', since: new Date('2026-11-01T12:00:00Z') }]);
      // Never the network's hash, nor who let it in, removed it or concluded it.
      expect(Object.keys(xa.liveEntries[0]!).sort()).toEqual([
        'addons', 'confirmedAt', 'country', 'currency', 'dropId', 'endedAt', 'entryId', 'gestureMs', 'handledAt', 'holdExpiresAt', 'joinedAt', 'letIn', 'position',
        'pressStartedAt', 'priceMinor', 'quantity', 'queuedAt', 'resolution', 'resolutionNote', 'securedAt', 'size', 'status', 'tier', 'title', 'turnAt', 'turnExpiresAt',
      ]);
      expect(xa.notIncluded).toContain('The network behind each entry of a LIVE RELEASE: only a keyed one-way hash of its prefix is kept, and erased 30 days after the release.');
      expect((await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'account.export').orderBy('id', 'desc').limit(1).executeTakeFirstOrThrow()).details).toMatchObject({ liveEntries: 1, liveInterest: 1 });
      const xb = await owners.exportData(b.id, f.admin);
      expect(xb.liveEntries).toEqual([expect.objectContaining({ status: 'CONFIRMED', confirmedAt: expect.any(Date), resolution: null, handledAt: null, resolutionNote: null })]);
    });

    it('keeps the network’s hash until 30 days after the release’s end, then erases it', async () => {
      const r = await release({ sizes: [{ label: '52', stock: 1 }] });
      const a = await accountOfTier(f, 0);
      f.clock.set(at(-MINUTE));
      await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id }, a.actor, { networkHash: new Uint8Array(32).fill(2) });
      f.clock.set(at(MINUTE));
      await f.live.end(r.id, f.admin);
      await eraseLiveNetworkHashes(t.db, new Date(at(MINUTE).getTime() + 30 * 86_400_000 - 1));
      expect((await entry(r.id, a.id)).network_hash).toEqual(new Uint8Array(32).fill(2));
      expect(await eraseLiveNetworkHashes(t.db, new Date(at(MINUTE).getTime() + 30 * 86_400_000))).toBeGreaterThanOrEqual(1);
      expect((await entry(r.id, a.id)).network_hash).toBeNull();
    });

    it('never writes an email in the audit log', async () => {
      const emails = (await t.db.selectFrom('accounts').select('email').execute()).map((x) => x.email);
      const logs = JSON.stringify(await t.db.selectFrom('audit_logs').select(['action', 'details', 'target_id']).where('action', 'like', 'drop.live.%').execute());
      expect(logs.length).toBeGreaterThan(1000);
      for (const e of emails) expect(logs).not.toContain(e);
    });
  });
});
