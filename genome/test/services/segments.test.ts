/**
 * Taking part in the releases and the segments (plan LIVE RELEASE+, choices 4 and 27; services/participation.ts,
 * services/segments.ts), against a migrated database and a manual clock:
 *
 *  - taking part, exactly as the plan's Architecture defines it: a place in the line of a LIVE RELEASE whose T0 has
 *    passed (QUEUED, then whatever became of it, LEFT included; never REMOVED, never WAITING or LEFT before T0), an
 *    after-room's entry counted as its release; a draw's entry not WITHDRAWN once it is drawn, and a place reserved
 *    directly during its early access before the draw; distinct releases; a cancelled one never;
 *  - each criterion of the four groups (releases and pieces secured; tier, models and collections; sizes and country;
 *    I'LL BE THERE, the answers after, the last activity), negated, in ALL and ANY groups and a group within;
 *  - the service: the live count, the options of the builder, created, renamed and changed (audited, the same twice is
 *    nothing), the names unique whatever the case, the ids named checked, deleted only when nothing uses it, and the
 *    members' CSV;
 *  - a post of the circle for a segment's members only, read again at each request;
 *  - the customer intelligence lot's criteria (plan CUSTOMER INTELLIGENCE §3.0 (g), §3.6 C.5.1, steps 8.1 to 8.4), each
 *    matched and negated, their bounds and refusals, the names they check: PERSON (the city given, folded; the age
 *    today in Paris; how they heard; a tag), TASTES (a wish for a model, a main model with its variants, or for a model
 *    of a collection; a favourite piece or finish). A test entrant matches none but through a NOT.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import { CircleService } from '../../src/server/services/circle.js';
import { participatedReleases, participations } from '../../src/server/services/participation.js';
import { cleanCriteria, isSegmentMember, SEGMENT_LIMITS, segmentMembers, SegmentService, type SegmentGroup } from '../../src/server/services/segments.js';
import { TAG_MAX } from '../../src/server/services/client-notes.js';
import { CITY_MAX } from '../../src/shared/profile-rules.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { accountOfTier, createAccount, createCollection, createLiveRelease, createModel, holdPieces, liveFixture, type LiveFixture } from '../support/live.js';
import { poolDraw } from '../support/draws.js';

const START = new Date('2026-11-01T09:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

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

describe('taking part, and the segments', () => {
  let t: TestDb;
  let f: LiveFixture;
  let segments: SegmentService;
  let circle: CircleService;
  /** The accounts of the scenario, by what they did. */
  const who = {} as Record<'buyer' | 'queued' | 'removed' | 'leftBefore' | 'leftAfter' | 'waiting' | 'drawn' | 'withdrew' | 'reserved' | 'undrawn' | 'cancelled' | 'nobody', { id: string; email: string; actor: { type: 'account'; id: string } }>;
  const releases = {} as Record<'live' | 'later' | 'draw' | 'undrawn' | 'cancelled', string>;

  const all = (...rules: unknown[]): SegmentGroup => cleanCriteria({ match: 'ALL', rules });
  const count = async (criteria: SegmentGroup) => (await segments.count(criteria)).count;
  /** The accounts of `ids` a tree matches, by their key in `who`. */
  const matched = async (criteria: SegmentGroup, keys: (keyof typeof who)[] = Object.keys(who) as (keyof typeof who)[]) => {
    const s = await segments.create({ name: `probe ${Math.random()}`, criteria }, f.admin);
    try {
      const out: string[] = [];
      for (const k of keys) if (await isSegmentMember(t.db, s.id, who[k].id, f.clock.now())) out.push(k);
      return out.sort();
    } finally {
      await segments.remove(s.id, f.admin);
    }
  };

  beforeAll(async () => {
    t = await createTestDb();
    f = await liveFixture(t.db, START.toISOString());
    segments = new SegmentService({ db: t.db, audit: f.audit, clock: f.clock.now });
    circle = new CircleService({ db: t.db, audit: f.audit, clock: f.clock.now });
    for (const k of Object.keys({ buyer: 0, queued: 0, removed: 0, leftBefore: 0, leftAfter: 0, waiting: 0, drawn: 0, withdrew: 0, reserved: 0, undrawn: 0, cancelled: 0, nobody: 0 }) as (keyof typeof who)[]) {
      who[k] = (await createAccount(t.db)) as (typeof who)[keyof typeof who];
    }

    // A LIVE RELEASE, T0 an hour on: in the room before T0, a buyer, one who stays in the line, one removed by ORBES,
    // one who leaves before T0 (no place), one who leaves after it (a place, then LEFT).
    const T0 = new Date(START.getTime() + HOUR);
    const live = await createLiveRelease(f, { opensAt: T0, sizes: [{ label: '52', stock: 1 }, { label: '54', stock: 3 }] });
    releases.live = live.id;
    f.clock.set(new Date(T0.getTime() - MINUTE));
    for (const k of ['buyer', 'queued', 'removed', 'leftBefore', 'leftAfter'] as const) await f.live.enter(who[k].id, live.id, { sizeId: live.sizes[k === 'buyer' ? 0 : 1]!.id }, who[k].actor);
    await f.live.leave(who.leftBefore.id, live.id, who.leftBefore.actor);
    f.clock.set(T0);
    await f.live.advance(live.id);
    const token = (await f.live.entry(who.buyer.id, live.id))!.turn!.token!;
    await f.live.press(who.buyer.id, live.id, token);
    f.clock.advance(1500);
    await f.live.secure(who.buyer.id, live.id, token, who.buyer.actor);
    await f.live.confirm(who.buyer.id, live.id, who.buyer.actor);
    await f.live.leave(who.leftAfter.id, live.id, who.leftAfter.actor);
    const removed = await t.db.selectFrom('live_entries').select('id').where('drop_id', '=', live.id).where('account_id', '=', who.removed.id).executeTakeFirstOrThrow();
    await f.live.remove(live.id, removed.id, f.admin);

    // A LIVE RELEASE still ahead: in its room, WAITING.
    const later = await createLiveRelease(f, { opensAt: new Date(f.clock.now().getTime() + 2 * HOUR) });
    releases.later = later.id;
    f.clock.set(new Date(f.clock.now().getTime() + 2 * HOUR - 2 * MINUTE));
    await f.live.enter(who.waiting.id, later.id, { sizeId: later.sizes[0]!.id }, who.waiting.actor);
    f.clock.set(new Date(START.getTime() + 2 * HOUR));

    // A draw, drawn: one entry kept, one withdrawn before the draw.
    const D = new Date(f.clock.now().getTime() + HOUR);
    const draw = await poolDraw(f.drops, f.db, { modelId: f.modelId, title: 'DRAWN', quantity: 1, opensAt: D, closesAt: new Date(D.getTime() + HOUR), earlyAccessHours: 0 }, f.admin);
    releases.draw = draw.id;
    // A draw with an early access, opened, not drawn yet: a place reserved directly (PLATINE), an entry waiting for the draw.
    const U = new Date(D.getTime() + 30 * MINUTE);
    const undrawn = await poolDraw(f.drops, f.db, { modelId: f.modelId, title: 'NOT DRAWN', quantity: 2, opensAt: U, closesAt: new Date(U.getTime() + 10 * DAY), earlyAccessHours: 48 }, f.admin);
    releases.undrawn = undrawn.id;
    await holdPieces(t.db, who.reserved.id, 5, f.modelId);
    await f.drops.reserve(who.reserved.id, undrawn.id, who.reserved.actor);
    // A draw cancelled after its opening (before its draw): its entries count for nobody.
    const cancelled = await poolDraw(f.drops, f.db, { modelId: f.modelId, title: 'CANCELLED', quantity: 1, opensAt: D, closesAt: new Date(D.getTime() + 20 * DAY), earlyAccessHours: 0 }, f.admin);
    releases.cancelled = cancelled.id;
    f.clock.set(new Date(D.getTime() + MINUTE));
    await f.drops.enter(who.drawn.id, draw.id, who.drawn.actor);
    await f.drops.enter(who.withdrew.id, draw.id, who.withdrew.actor);
    await f.drops.withdraw(who.withdrew.id, draw.id, who.withdrew.actor);
    await f.drops.enter(who.cancelled.id, cancelled.id, who.cancelled.actor);
    await f.drops.cancel(cancelled.id, f.admin);
    f.clock.set(new Date(U.getTime() + MINUTE));
    await f.drops.enter(who.undrawn.id, undrawn.id, who.undrawn.actor);
    f.clock.set(new Date(D.getTime() + 2 * HOUR));
    await f.drops.draw(draw.id, f.admin);
  });
  afterAll(() => t.close());

  describe('taking part (choice 4, the Architecture)', () => {
    it('counts a place in the line of a LIVE RELEASE past its T0, whatever became of it, but never REMOVED nor before T0', async () => {
      const now = f.clock.now();
      expect(await participations(t.db, who.buyer.id, now)).toBe(1);
      expect(await participations(t.db, who.queued.id, now)).toBe(1);
      expect(await participations(t.db, who.leftAfter.id, now)).toBe(1);
      expect(await participations(t.db, who.removed.id, now)).toBe(0);
      expect(await participations(t.db, who.leftBefore.id, now)).toBe(0);
      expect(await participations(t.db, who.waiting.id, now)).toBe(0);
      // The release itself left out (an access rule never counts the release it guards).
      expect(await participations(t.db, who.buyer.id, now, releases.live)).toBe(0);
      expect([...(await participatedReleases(t.db, who.buyer.id, now))]).toEqual([releases.live]);
    });

    it('counts a draw’s entry not withdrawn once drawn, and a place reserved directly before the draw; never a cancelled draw', async () => {
      const now = f.clock.now();
      expect(await participations(t.db, who.drawn.id, now)).toBe(1);
      expect(await participations(t.db, who.withdrew.id, now)).toBe(0);
      expect(await participations(t.db, who.reserved.id, now)).toBe(1);
      expect(await participations(t.db, who.undrawn.id, now)).toBe(0);
      expect(await participations(t.db, who.cancelled.id, now)).toBe(0);
      expect(await participations(t.db, who.nobody.id, now)).toBe(0);
    });

    it('counts each release once, an after-room as the release it follows', async () => {
      // A release with an after-room: a sell-out with one guest left in the line, who enters the after-room.
      const afterModel = await createModel(t.db, 'AFTERGLOW');
      f.clock.set(new Date(f.clock.now().getTime() + DAY));
      const T0 = new Date(f.clock.now().getTime() + HOUR);
      const r = await createLiveRelease(f, {
        opensAt: T0,
        sizes: [{ label: '52', stock: 1 }],
        afterRoom: { modelId: afterModel, priceMinor: 1000, sizes: [{ label: 'ONE SIZE', stock: 1 }], delayMinutes: 1, lengthMinutes: 5 },
      });
      const [a, b] = [await accountOfTier(f, 3), await accountOfTier(f, 0)];
      f.clock.set(new Date(T0.getTime() - MINUTE));
      for (const p of [a, b]) await f.live.enter(p.id, r.id, { sizeId: r.sizes[0]!.id }, p.actor);
      f.clock.set(T0);
      await f.live.advance(r.id);
      const token = (await f.live.entry(a.id, r.id))!.turn!.token!;
      await f.live.press(a.id, r.id, token);
      f.clock.advance(1500);
      await f.live.secure(a.id, r.id, token, a.actor);
      await f.live.confirm(a.id, r.id, a.actor);
      await f.live.advance(r.id);
      f.clock.advance(MINUTE + SECOND);
      await f.live.enter(b.id, r.afterRoom!.id, { sizeId: r.afterRoom!.sizes[0]!.id }, b.actor);
      const entries = await t.db.selectFrom('live_entries').select(['drop_id', 'position']).where('account_id', '=', b.id).execute();
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.position !== null)).toBe(true);
      expect(await participations(t.db, b.id, f.clock.now())).toBe(1);
      expect([...(await participatedReleases(t.db, b.id, f.clock.now()))]).toEqual([r.id]);
    });
  });

  describe('the criteria (choice 27)', () => {
    it('releases taken part in and pieces secured: at least N, in one release, negated', async () => {
      expect(await matched(all({ kind: 'PARTICIPATIONS', min: 1 }))).toEqual(['buyer', 'drawn', 'leftAfter', 'queued', 'reserved']);
      expect(await matched(all({ kind: 'TOOK_PART', dropId: releases.live }))).toEqual(['buyer', 'leftAfter', 'queued']);
      expect(await matched(all({ kind: 'TOOK_PART', dropId: releases.draw }))).toEqual(['drawn']);
      expect(await matched(all({ kind: 'SECURED', min: 1 }))).toEqual(['buyer']);
      expect(await matched(all({ kind: 'SECURED_IN', dropId: releases.live }))).toEqual(['buyer']);
      // Took part without securing a piece: the question after's audience.
      expect(await matched(all({ kind: 'TOOK_PART', dropId: releases.live }, { kind: 'SECURED_IN', dropId: releases.live, not: true }))).toEqual(['leftAfter', 'queued']);
      expect(await matched(all({ kind: 'PARTICIPATIONS', min: 2 }))).toEqual([]);
    });

    it('the tier now, a piece held of some models or collections (the piece’s own collection first)', async () => {
      const collection = await createCollection(t.db, 'NOCTURNE');
      const other = await createModel(t.db, 'HALO', collection);
      await holdPieces(t.db, who.nobody.id, 1, other);
      await holdPieces(t.db, who.queued.id, 1, f.modelId, { collectionId: collection });
      expect(await matched(all({ kind: 'TIER', tiers: [2] }))).toEqual(['reserved']);
      expect(await matched(all({ kind: 'TIER', tiers: [1, 2] }))).toEqual(['nobody', 'queued', 'reserved']);
      expect(await matched(all({ kind: 'OWNS_MODEL', modelIds: [other] }))).toEqual(['nobody']);
      expect(await matched(all({ kind: 'OWNS_COLLECTION', collectionIds: [collection] }))).toEqual(['nobody', 'queued']);
      // A piece revoked counts for nothing in the club.
      await t.db.updateTable('products').set({ status: 'REVOKED' }).where('model_id', '=', other).execute();
      expect(await matched(all({ kind: 'OWNS_MODEL', modelIds: [other] }))).toEqual([]);
      expect(await matched(all({ kind: 'TIER', tiers: [0] }), ['nobody'])).toEqual(['nobody']);
    });

    it('a size (a piece held, a size chosen in a release or said I’LL BE THERE, an order’s) and the country (the account’s, else its latest entry’s)', async () => {
      // The buyer chose 52 in the release; the one waiting in the room of the next one too.
      expect(await matched(all({ kind: 'SIZE', sizes: ['52'] }))).toEqual(['buyer', 'waiting']);
      // A size chosen on entering counts, whatever became of the entry.
      expect(await matched(all({ kind: 'SIZE', sizes: [' 54 '] }))).toEqual(['leftAfter', 'leftBefore', 'queued', 'removed']);
      await holdPieces(t.db, who.drawn.id, 1, f.modelId, { variant: 'm' });
      expect(await matched(all({ kind: 'SIZE', sizes: ['M'] }))).toEqual(['drawn']);
      await t.db.updateTable('accounts').set({ country: 'FR' }).where('id', '=', who.waiting.id).execute();
      await t.db.updateTable('live_entries').set({ country: 'IT' }).where('account_id', 'in', [who.waiting.id, who.queued.id]).execute();
      expect(await matched(all({ kind: 'COUNTRY', countries: ['fr'] }))).toEqual(['waiting']);
      expect(await matched(all({ kind: 'COUNTRY', countries: ['IT'] }))).toEqual(['queued']);
    });

    it('I’LL BE THERE, an answer to the question after, the last activity', async () => {
      const ahead = await createLiveRelease(f, { opensAt: new Date(f.clock.now().getTime() + DAY) });
      await f.live.setInterest(who.nobody.id, ahead.id, ahead.sizes[0]!.id, who.nobody.actor);
      expect(await matched(all({ kind: 'INTEREST', dropId: null }))).toEqual(['nobody']);
      expect(await matched(all({ kind: 'INTEREST', dropId: releases.live }))).toEqual([]);
      await t.db.insertInto('release_answers').values({ drop_id: releases.live, account_id: who.queued.id, answer: 2 }).execute();
      expect(await matched(all({ kind: 'ANSWER', dropId: releases.live, answer: 2 }))).toEqual(['queued']);
      expect(await matched(all({ kind: 'ANSWER', dropId: releases.live, answer: 1 }))).toEqual([]);
      // A sign-in (its audit entry), a session in use, a scan: within the days.
      const now = f.clock.now();
      await f.audit.record({ actor: who.drawn.actor, action: 'account.login', targetType: 'account', targetId: who.drawn.id });
      await t.db.insertInto('scan_events').values({ event_type: 'VERIFY', result_state: 'AUTHENTIC', account_id: who.withdrew.id, occurred_at: new Date(now.getTime() - 40 * DAY) }).execute();
      expect(await matched(all({ kind: 'ACTIVE', days: 30 }), ['drawn', 'withdrew', 'nobody'])).toEqual(['drawn']);
      expect(await matched(all({ kind: 'ACTIVE', days: 60 }), ['drawn', 'withdrew', 'nobody'])).toEqual(['drawn', 'withdrew']);
      expect(await matched(all({ kind: 'ACTIVE', days: 60, not: true }), ['drawn', 'withdrew', 'nobody'])).toEqual(['nobody']);
    });

    it('ALL, ANY, a group within; only ACTIVE accounts', async () => {
      const tree = cleanCriteria({
        match: 'ANY',
        rules: [
          { kind: 'SECURED', min: 1 },
          { match: 'ALL', rules: [{ kind: 'TOOK_PART', dropId: releases.draw }, { kind: 'SIZE', sizes: ['M'] }] },
        ],
      });
      expect(await matched(tree)).toEqual(['buyer', 'drawn']);
      await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', who.buyer.id).execute();
      expect(await matched(tree)).toEqual(['drawn']);
      await t.db.updateTable('accounts').set({ status: 'ACTIVE' }).where('id', '=', who.buyer.id).execute();
      // Counted over every account: the after-room's buyer too.
      expect(await count(tree)).toBe(3);
    });

    it('refuses a tree it cannot read: an unknown criterion, a group too deep, a bound passed, a list empty', () => {
      const bad = (v: unknown) => expect(() => cleanCriteria(v)).toThrow(DomainError);
      bad({ match: 'ALL', rules: [] });
      bad({ match: 'SOME', rules: [{ kind: 'SECURED', min: 1 }] });
      bad({ match: 'ALL', rules: [{ kind: 'LUCK' }] });
      bad({ match: 'ALL', rules: [{ kind: 'PARTICIPATIONS', min: 0 }] });
      bad({ match: 'ALL', rules: [{ kind: 'ACTIVE', days: 3651 }] });
      bad({ match: 'ALL', rules: [{ kind: 'TIER', tiers: [] }] });
      bad({ match: 'ALL', rules: [{ kind: 'COUNTRY', countries: ['FRA'] }] });
      bad({ match: 'ALL', rules: [{ match: 'ANY', rules: [{ match: 'ALL', rules: [{ kind: 'SECURED', min: 1 }] }] }] });
      bad({ match: 'ALL', rules: Array.from({ length: 21 }, () => ({ kind: 'SECURED', min: 1 })) });
      // Lists sorted, deduplicated, in capitals: a tree is written the same way every time.
      expect(cleanCriteria({ match: 'ALL', rules: [{ kind: 'SIZE', sizes: ['54', ' 52', '54'] }, { kind: 'TIER', tiers: [3, 2, 3], not: false }] })).toEqual({
        match: 'ALL',
        rules: [
          { kind: 'SIZE', sizes: ['52', '54'] },
          { kind: 'TIER', tiers: [2, 3] },
        ],
      });
    });
  });

  describe('the service', () => {
    it('creates, renames and changes a segment, audited; the same again is nothing; names unique whatever the case', async () => {
      const s = await segments.create({ name: '  Regulars  ', criteria: { match: 'ALL', rules: [{ kind: 'PARTICIPATIONS', min: 1 }] } }, f.admin);
      // The five of the scenario, and the two of the after-room's release.
      expect(s).toMatchObject({ name: 'Regulars', count: 7, usedBy: { releases: [], posts: [] }, createdBy: { id: f.admin.id } });
      await rejects(segments.create({ name: 'REGULARS', criteria: s.criteria }, f.admin), 'SEGMENT_NAME_TAKEN', 409);
      const same = await segments.update(s.id, { name: 'Regulars', criteria: s.criteria }, f.admin);
      expect(same.updatedAt).toEqual(s.updatedAt);
      f.clock.advance(SECOND);
      const changed = await segments.update(s.id, { criteria: { match: 'ALL', rules: [{ kind: 'SECURED', min: 1 }] } }, f.admin);
      // The buyer, and the buyer of the after-room's release.
      expect(changed.count).toBe(2);
      const audits = await t.db.selectFrom('audit_logs').select(['action', 'details']).where('target_id', '=', s.id).orderBy('id').execute();
      expect(audits.map((a) => a.action)).toEqual(['segment.create', 'segment.update']);
      expect(audits[1]!.details).toEqual({
        before: { criteria: { match: 'ALL', rules: [{ kind: 'PARTICIPATIONS', min: 1 }] } },
        after: { criteria: { match: 'ALL', rules: [{ kind: 'SECURED', min: 1 }] } },
      });
      await rejects(segments.update(s.id, { name: '' }, f.admin), 'VALIDATION_FAILED', 400);
      await segments.remove(s.id, f.admin);
      await rejects(segments.get(s.id), 'SEGMENT_NOT_FOUND', 404);
    });

    it('checks what a tree names: the releases, models and collections exist; an answer is one of its release’s question', async () => {
      const unknown = '00000000-0000-4000-8000-000000000000';
      await rejects(segments.count({ match: 'ALL', rules: [{ kind: 'TOOK_PART', dropId: unknown }] }), 'DROP_NOT_FOUND', 404);
      await rejects(segments.count({ match: 'ALL', rules: [{ kind: 'OWNS_MODEL', modelIds: [unknown] }] }), 'MODEL_NOT_FOUND', 404);
      await rejects(segments.count({ match: 'ALL', rules: [{ kind: 'OWNS_COLLECTION', collectionIds: [unknown] }] }), 'COLLECTION_NOT_FOUND', 404);
      await rejects(segments.count({ match: 'ALL', rules: [{ kind: 'ANSWER', dropId: releases.draw, answer: 1 }] }), 'VALIDATION_FAILED', 400);
      await rejects(segments.count({ match: 'ALL', rules: [{ kind: 'ANSWER', dropId: releases.live, answer: 4 }] }), 'VALIDATION_FAILED', 400);
      await rejects(segments.count({ match: 'ALL', rules: [{ kind: 'INTEREST', dropId: releases.draw }] }), 'VALIDATION_FAILED', 400);
      expect(await segments.count({ match: 'ALL', rules: [{ kind: 'ANSWER', dropId: releases.live, answer: 3 }] })).toEqual({ count: 0 });
    });

    it('gives the builder the releases (a LIVE one with its question’s answers), models, collections, sizes and countries', async () => {
      const o = await segments.options();
      expect(o.releases.find((r) => r.id === releases.live)).toMatchObject({ mode: 'LIVE', answers: ['ANOTHER SIZE', 'ANOTHER FINISH', 'ANOTHER PRICE BAND'] });
      expect(o.releases.find((r) => r.id === releases.draw)).toMatchObject({ mode: 'DRAW', answers: null });
      // Never an after-room, never a cancelled release.
      expect(o.releases.some((r) => r.id === releases.cancelled)).toBe(false);
      expect(o.releases.some((r) => r.title.endsWith('THE AFTER-ROOM'))).toBe(false);
      expect(o.sizes).toEqual(expect.arrayContaining(['52', '54', 'M', 'ONE SIZE']));
      expect(o.countries).toEqual(expect.arrayContaining(['FR', 'IT']));
      expect(o.models.map((m) => m.name)).toEqual(expect.arrayContaining(['MONOLITHE', 'HALO']));
    });

    it('is never deleted while a release or a post of the circle uses it; lists what uses it', async () => {
      const s = await segments.create({ name: 'Buyers', criteria: { match: 'ALL', rules: [{ kind: 'SECURED', min: 1 }] } }, f.admin);
      await t.db.updateTable('drops').set({ access_segment_id: s.id }).where('id', '=', releases.later).execute();
      const post = await circle.create({ kind: 'NOTE', title: 'For the buyers', segmentId: s.id }, f.admin);
      const used = await segments.get(s.id);
      expect(used.usedBy).toEqual({ releases: [{ id: releases.later, title: 'LIVE' }], posts: [{ id: post.id, title: 'For the buyers' }] });
      await rejects(segments.remove(s.id, f.admin), 'SEGMENT_IN_USE', 409);
      await t.db.updateTable('drops').set({ access_segment_id: null }).where('id', '=', releases.later).execute();
      await circle.update(post.id, { segmentId: null }, f.admin);
      await segments.remove(s.id, f.admin);
      expect((await t.db.selectFrom('audit_logs').select('action').where('target_id', '=', s.id).orderBy('id').execute()).map((a) => a.action)).toEqual(['segment.create', 'segment.delete']);
    });

    it('lists its members in a CSV, each email as the caller may read it, with their tier, releases and pieces', async () => {
      const s = await segments.create({ name: 'In the line', criteria: { match: 'ALL', rules: [{ kind: 'TOOK_PART', dropId: releases.live }] } }, f.admin);
      const file = await segments.csv(s.id, { email: (e) => `masked:${e.split('@')[0]!.slice(0, 1)}` });
      expect(file.filename).toBe('orbes-segment-in-the-line.csv');
      const lines = file.body.trim().split('\r\n');
      expect(lines[0]).toBe('"email","country","tier","pieces held","releases taken part in","pieces secured","account created"');
      expect(lines).toHaveLength(4);
      const buyer = lines.find((l) => l.includes(`masked:l`) && l.endsWith(`"`) && l.includes('"1","1"'));
      expect(buyer).toBeDefined();
      await segments.remove(s.id, f.admin);
    });
  });

  describe('a post of the circle for a segment (choice 27)', () => {
    it('reads for the segment’s members among its tiers only, read again at each request; the same 404 for anyone else', async () => {
      const owner = await accountOfTier(f, 2);
      const outsider = await accountOfTier(f, 2);
      const s = await segments.create({ name: 'Size 58', criteria: { match: 'ALL', rules: [{ kind: 'SIZE', sizes: ['58'] }] } }, f.admin);
      const note = await circle.create({ kind: 'NOTE', title: 'A word for size 58', segmentId: s.id }, f.admin);
      const poll = await circle.create({ kind: 'POLL', title: 'Which finish?', pollOptions: ['POLISHED', 'BRUSHED'], segmentId: s.id }, f.admin);
      await circle.publish(note.id, f.admin);
      await circle.publish(poll.id, f.admin);
      expect((await circle.get(note.id)).segment).toEqual({ id: s.id, name: 'Size 58' });
      const titles = async (a: { id: string }) => (await circle.feed(a.id, { page: 1, pageSize: 50 })).items.map((p) => p.title);
      expect(await titles(owner)).not.toContain('A word for size 58');
      await rejects(circle.post(owner.id, note.id), 'CIRCLE_POST_NOT_FOUND', 404);
      await rejects(circle.vote(owner.id, poll.id, 0), 'CIRCLE_POST_NOT_FOUND', 404);
      // A piece in size 58 now: the owner belongs, at the next request.
      await holdPieces(t.db, owner.id, 1, f.modelId, { variant: '58' });
      expect(await titles(owner)).toEqual(expect.arrayContaining(['A word for size 58', 'Which finish?']));
      expect((await circle.post(owner.id, note.id)).title).toBe('A word for size 58');
      expect((await circle.vote(owner.id, poll.id, 1)).poll?.vote).toBe(1);
      expect(await titles(outsider)).not.toContain('A word for size 58');
      const audit = await t.db.selectFrom('audit_logs').select('details').where('target_id', '=', note.id).where('action', '=', 'circle.post.create').executeTakeFirstOrThrow();
      expect(audit.details).toMatchObject({ segmentId: s.id });
      await rejects(circle.update(note.id, { segmentId: '00000000-0000-4000-8000-000000000000' }, f.admin), 'SEGMENT_NOT_FOUND', 404);
    });
  });
});

describe('the customer intelligence criteria (plan CUSTOMER INTELLIGENCE §3.0 (g), §3.6 C.5.1)', () => {
  let t: TestDb;
  let f: LiveFixture;
  let segments: SegmentService;
  /** The accounts of the scenario, by name; `entrant` is a test entrant, which has no profile, wish, view nor source. */
  const p = {} as Record<'one' | 'two' | 'three' | 'four' | 'entrant', string>;
  const heard = {} as Record<'instagram' | 'friend', string>;
  const m = {} as Record<'main' | 'blue' | 'orbit' | 'nocturne' | 'noir', string>;

  const all = (...rules: unknown[]): SegmentGroup => cleanCriteria({ match: 'ALL', rules });
  /** The accounts of the scenario a tree matches now, by name. */
  const matched = async (criteria: SegmentGroup) => {
    const ids = await segmentMembers(t.db, criteria, f.clock.now()).select('a.id').where('a.id', 'in', Object.values(p)).execute();
    return (Object.keys(p) as (keyof typeof p)[]).filter((k) => ids.some((r) => r.id === p[k])).sort();
  };
  const bad = (...rules: unknown[]) => expect(() => cleanCriteria({ match: 'ALL', rules })).toThrow(DomainError);

  beforeAll(async () => {
    t = await createTestDb();
    // 28 February 2027, a common year, at noon in Paris.
    f = await liveFixture(t.db, '2027-02-28T11:00:00.000Z');
    segments = new SegmentService({ db: t.db, audit: f.audit, clock: f.clock.now });
    for (const k of ['one', 'two', 'three', 'four', 'entrant'] as const) p[k] = (await createAccount(t.db)).id;
    await t.db.insertInto('test_entrants').values({ account_id: p.entrant }).execute();
    heard.instagram = (await t.db.insertInto('heard_options').values({ label: 'Instagram', position: 1 }).returning('id').executeTakeFirstOrThrow()).id;
    heard.friend = (await t.db.insertInto('heard_options').values({ label: 'A friend', position: 2 }).returning('id').executeTakeFirstOrThrow()).id;
    const at = f.clock.now();
    await t.db
      .insertInto('account_profiles')
      .values([
        { account_id: p.one, city: 'Saint-Étienne', birth_date: '2008-02-29', birth_date_by: 'COLLECTOR', birth_date_at: at, heard_option_id: heard.instagram, heard_at: at },
        { account_id: p.two, city: 'LYON', birth_date: '2008-03-01', birth_date_by: 'STAFF', birth_date_at: at, heard_option_id: heard.friend, heard_at: at },
        { account_id: p.three, city: 'saint-etienne', birth_date: '1990-06-15', birth_date_by: 'COLLECTOR', birth_date_at: at },
        { account_id: p.four },
      ])
      .execute();
    await t.db
      .insertInto('account_tags')
      .values([
        { account_id: p.one, tag: 'VIP', created_by: f.admin.id },
        { account_id: p.one, tag: 'PRESS', created_by: f.admin.id },
        { account_id: p.two, tag: 'VIP', created_by: f.admin.id },
      ])
      .execute();

    // MONOLITHE and its variant Blue, outside any collection; ORBIT in NOCTURNE; a second collection, NOIR.
    m.nocturne = await createCollection(t.db, 'NOCTURNE');
    m.noir = await createCollection(t.db, 'NOIR');
    m.main = await createModel(t.db, 'MONOLITHE');
    m.blue = await createModel(t.db, 'MONOLITHE');
    await t.db.updateTable('models').set({ variant_label: 'Steel', variant_swatch: '#8A8D91' }).where('id', '=', m.main).execute();
    await t.db.updateTable('models').set({ variant_of: m.main, variant_label: 'Blue', variant_swatch: '#1F3A93' }).where('id', '=', m.blue).execute();
    m.orbit = await createModel(t.db, 'ORBIT', m.nocturne, 'CUFF');
    const day = (d: string) => new Date(`${d}T10:00:00.000Z`);
    await t.db
      .insertInto('account_wishes')
      .values([
        { account_id: p.one, model_id: m.blue, added_at: day('2027-01-10') },
        { account_id: p.two, model_id: m.main, added_at: day('2027-01-11') },
        { account_id: p.two, model_id: m.orbit, added_at: day('2027-01-12'), removed_at: day('2027-01-20') },
        { account_id: p.three, model_id: m.orbit, added_at: day('2027-01-13') },
      ])
      .execute();
    // The second's ROSE GOLD is no longer in the collection: no model carries it.
    await t.db
      .insertInto('account_tastes')
      .values([
        { account_id: p.one, kind: 'PIECE', value_key: 'RING', label: 'Ring' },
        { account_id: p.one, kind: 'FINISH', value_key: 'BLUE', label: 'Blue' },
        { account_id: p.two, kind: 'PIECE', value_key: 'CUFF', label: 'Cuff' },
        { account_id: p.two, kind: 'FINISH', value_key: 'ROSE GOLD', label: 'Rose gold' },
      ])
      .execute();
  });
  afterAll(() => t.close());

  describe('PERSON (step 8.1)', () => {
    it('CITY: the city given in YOUR PROFILE, whatever its case and accents; negated', async () => {
      expect(await matched(all({ kind: 'CITY', cities: ['SAINT-ÉTIENNE'] }))).toEqual(['one', 'three']);
      expect(await matched(all({ kind: 'CITY', cities: ['lyon', 'Milan'] }))).toEqual(['two']);
      expect(await matched(all({ kind: 'CITY', cities: ['Saint-Etienne'], not: true }))).toEqual(['entrant', 'four', 'two']);
      // Stored folded, sorted and once: a segment is written the same way every time.
      expect(all({ kind: 'CITY', cities: [' Saint-Étienne ', 'SAINT-ETIENNE', 'Lyon'] }).rules).toEqual([{ kind: 'CITY', cities: ['lyon', 'saint-etienne'] }]);
    });

    it('AGE: the age today in Paris from the date of birth, a birthday on 29 February counted on 28 February; negated', async () => {
      expect(await matched(all({ kind: 'AGE', min: 19, max: 19 }))).toEqual(['one']);
      expect(await matched(all({ kind: 'AGE', min: 18, max: 18 }))).toEqual(['two']);
      expect(await matched(all({ kind: 'AGE', min: 18, max: 19 }))).toEqual(['one', 'two']);
      expect(await matched(all({ kind: 'AGE', min: 0, max: 120 }))).toEqual(['one', 'three', 'two']);
      expect(await matched(all({ kind: 'AGE', min: 36, max: 36 }))).toEqual(['three']);
      expect(await matched(all({ kind: 'AGE', min: 18, max: 19, not: true }))).toEqual(['entrant', 'four', 'three']);
      // 1 March at 00:30 in Paris (23:30 UTC the day before): the second turns 19.
      const was = f.clock.now();
      f.clock.set(new Date('2027-02-28T23:30:00.000Z'));
      expect(await matched(all({ kind: 'AGE', min: 19, max: 19 }))).toEqual(['one', 'two']);
      f.clock.set(was);
    });

    it('HEARD_FROM: the answer to « How did you hear about ORBES? », an answer set aside included; negated', async () => {
      expect(await matched(all({ kind: 'HEARD_FROM', optionIds: [heard.instagram] }))).toEqual(['one']);
      expect(await matched(all({ kind: 'HEARD_FROM', optionIds: [heard.instagram, heard.friend] }))).toEqual(['one', 'two']);
      await t.db.updateTable('heard_options').set({ active: false }).where('id', '=', heard.friend).execute();
      expect(await matched(all({ kind: 'HEARD_FROM', optionIds: [heard.friend] }))).toEqual(['two']);
      expect(await matched(all({ kind: 'HEARD_FROM', optionIds: [heard.friend], not: true }))).toEqual(['entrant', 'four', 'one', 'three']);
    });

    it('TAGGED: any of the tags, cleaned as tags are; a tag removed matches fewer; negated', async () => {
      expect(await matched(all({ kind: 'TAGGED', tags: ['vip'] }))).toEqual(['one', 'two']);
      expect(await matched(all({ kind: 'TAGGED', tags: ['  press ', 'FRIEND OF THE HOUSE'] }))).toEqual(['one']);
      expect(await matched(all({ kind: 'TAGGED', tags: ['VIP'], not: true }))).toEqual(['entrant', 'four', 'three']);
      expect(all({ kind: 'TAGGED', tags: ['friend  of the house’s', 'vip'] }).rules).toEqual([{ kind: 'TAGGED', tags: ['FRIEND OF THE HOUSE’S', 'VIP'] }]);
      await t.db.deleteFrom('account_tags').where('account_id', '=', p.two).where('tag', '=', 'VIP').execute();
      expect(await matched(all({ kind: 'TAGGED', tags: ['VIP'] }))).toEqual(['one']);
    });

    it('nests and combines with the existing criteria', async () => {
      const tree = cleanCriteria({ match: 'ANY', rules: [{ kind: 'TAGGED', tags: ['PRESS'] }, { match: 'ALL', rules: [{ kind: 'CITY', cities: ['saint-étienne'] }, { kind: 'AGE', min: 30, max: 40 }] }] });
      expect(await matched(tree)).toEqual(['one', 'three']);
    });

    it('refuses a rule out of its bounds; checks the answers named; its bounds are the profile\'s and the tags\'', async () => {
      bad({ kind: 'CITY', cities: [] });
      bad({ kind: 'CITY', cities: ['   '] });
      bad({ kind: 'CITY', cities: ['x'.repeat(81)] });
      bad({ kind: 'CITY', cities: Array.from({ length: 51 }, (_, i) => `City ${i}`) });
      bad({ kind: 'AGE', min: 35, max: 25 });
      bad({ kind: 'AGE', min: -1, max: 25 });
      bad({ kind: 'AGE', min: 25, max: 121 });
      bad({ kind: 'AGE', min: 25.5, max: 30 });
      bad({ kind: 'AGE', min: 25 });
      bad({ kind: 'HEARD_FROM', optionIds: ['instagram'] });
      bad({ kind: 'HEARD_FROM', optionIds: [] });
      bad({ kind: 'TAGGED', tags: ['#VIP'] });
      bad({ kind: 'TAGGED', tags: ['x'.repeat(33)] });
      expect(() => cleanCriteria({ match: 'ALL', rules: [{ kind: 'AGE', min: 35, max: 25 }] })).toThrow('Age between N and N: whole years from 0 to 120, the first not above the second.');
      expect(all({ kind: 'AGE', min: 0, max: 120, not: true }).rules).toEqual([{ kind: 'AGE', min: 0, max: 120, not: true }]);
      await rejects(segments.count({ match: 'ALL', rules: [{ kind: 'HEARD_FROM', optionIds: ['00000000-0000-4000-8000-000000000000'] }] }), 'HEARD_OPTION_NOT_FOUND', 404);
      expect(await segments.count({ match: 'ALL', rules: [{ kind: 'HEARD_FROM', optionIds: [heard.instagram] }] })).toEqual({ count: 1 });
      expect([SEGMENT_LIMITS.city, SEGMENT_LIMITS.tag]).toEqual([CITY_MAX, TAG_MAX]);
    });
  });

  describe('TASTES (step 8.2)', () => {
    it('WISHES_MODEL: an open wish; a main model named includes its variants, a variant only itself; a removed wish no longer; negated', async () => {
      expect(await matched(all({ kind: 'WISHES_MODEL', modelIds: [m.main] }))).toEqual(['one', 'two']);
      expect(await matched(all({ kind: 'WISHES_MODEL', modelIds: [m.blue] }))).toEqual(['one']);
      expect(await matched(all({ kind: 'WISHES_MODEL', modelIds: [m.orbit] }))).toEqual(['three']);
      expect(await matched(all({ kind: 'WISHES_MODEL', modelIds: [m.main], not: true }))).toEqual(['entrant', 'four', 'three']);
    });

    it('WISHES_COLLECTION: an open wish for a model of the collection, following a model moved; negated', async () => {
      expect(await matched(all({ kind: 'WISHES_COLLECTION', collectionIds: [m.nocturne] }))).toEqual(['three']);
      expect(await matched(all({ kind: 'WISHES_COLLECTION', collectionIds: [m.noir] }))).toEqual([]);
      await t.db.updateTable('models').set({ collection_id: m.noir }).where('id', 'in', [m.blue, m.orbit]).execute();
      expect(await matched(all({ kind: 'WISHES_COLLECTION', collectionIds: [m.noir] }))).toEqual(['one', 'three']);
      expect(await matched(all({ kind: 'WISHES_COLLECTION', collectionIds: [m.nocturne] }))).toEqual([]);
      expect(await matched(all({ kind: 'WISHES_COLLECTION', collectionIds: [m.noir], not: true }))).toEqual(['entrant', 'four', 'two']);
      await t.db.updateTable('models').set({ collection_id: null }).where('id', '=', m.blue).execute();
      await t.db.updateTable('models').set({ collection_id: m.nocturne }).where('id', '=', m.orbit).execute();
    });

    it('FAVOURITE_PIECE and FAVOURITE_FINISH: a key chosen, written as keys are; one no longer in the collection still matches; negated', async () => {
      expect(await matched(all({ kind: 'FAVOURITE_PIECE', pieces: ['ring'] }))).toEqual(['one']);
      expect(await matched(all({ kind: 'FAVOURITE_PIECE', pieces: ['RING', 'Cuff'] }))).toEqual(['one', 'two']);
      expect(await matched(all({ kind: 'FAVOURITE_FINISH', finishes: [' Rose  gold '] }))).toEqual(['two']);
      expect(await matched(all({ kind: 'FAVOURITE_FINISH', finishes: ['RING'] }))).toEqual([]);
      expect(await matched(all({ kind: 'FAVOURITE_PIECE', pieces: ['RING'], not: true }))).toEqual(['entrant', 'four', 'three', 'two']);
      expect(all({ kind: 'FAVOURITE_FINISH', finishes: ['rose gold', 'ROSE  GOLD', 'Blue'] }).rules).toEqual([{ kind: 'FAVOURITE_FINISH', finishes: ['BLUE', 'ROSE GOLD'] }]);
    });

    it('nests; a test entrant matches none, and still holds the release\'s model for OWNS_MODEL (unchanged)', async () => {
      const tree = cleanCriteria({
        match: 'ANY',
        rules: [
          { kind: 'WISHES_MODEL', modelIds: [m.blue] },
          { match: 'ALL', rules: [{ kind: 'FAVOURITE_PIECE', pieces: ['CUFF'] }, { kind: 'FAVOURITE_FINISH', finishes: ['ROSE GOLD'] }] },
        ],
      });
      expect(await matched(tree)).toEqual(['one', 'two']);
      expect(await matched(all({ kind: 'OWNS_MODEL', modelIds: [m.main] }))).toEqual(['entrant']);
    });

    it('refuses a rule out of its bounds; checks the models and collections named, never the keys', async () => {
      bad({ kind: 'WISHES_MODEL', modelIds: [] });
      bad({ kind: 'WISHES_MODEL', modelIds: ['MONOLITHE'] });
      bad({ kind: 'WISHES_COLLECTION', collectionIds: Array.from({ length: 51 }, () => m.noir) });
      bad({ kind: 'FAVOURITE_PIECE', pieces: ['  '] });
      bad({ kind: 'FAVOURITE_FINISH', finishes: ['x'.repeat(61)] });
      bad({ kind: 'FAVOURITE_FINISH', finishes: [] });
      const unknown = '00000000-0000-4000-8000-000000000000';
      await rejects(segments.count({ match: 'ALL', rules: [{ kind: 'WISHES_MODEL', modelIds: [m.main, unknown] }] }), 'MODEL_NOT_FOUND', 404);
      await rejects(segments.count({ match: 'ALL', rules: [{ kind: 'WISHES_COLLECTION', collectionIds: [unknown] }] }), 'COLLECTION_NOT_FOUND', 404);
      expect(await segments.count({ match: 'ALL', rules: [{ kind: 'FAVOURITE_FINISH', finishes: ['NEVER OFFERED'] }] })).toEqual({ count: 0 });
      expect(await segments.count({ match: 'ALL', rules: [{ kind: 'WISHES_MODEL', modelIds: [m.main] }] })).toEqual({ count: 2 });
    });
  });
});
